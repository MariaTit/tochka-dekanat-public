import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../src/db/database.js';
import { createDemoUsers } from '../src/services/demo-users.js';
import { hashPassword, verifyPassword } from '../src/services/passwords.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'auth-tests');
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(path.join(cache, 'run-'));
const databasePath = path.join(directory, 'test.sqlite');
const secret = randomBytes(48).toString('base64url');

async function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, ['src/index.js'], {
    cwd: path.join(root, 'server'), windowsHide: true,
    env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0', NODE_ENV: 'test', AMVERA: '', TRUST_PROXY: '0', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  const url = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`Запуск сервера: ${errors}`)); }, 15000);
    child.stderr.on('data', (chunk) => { errors += chunk.toString(); });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timeout); resolve(match[0]); }
    });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Сервер завершился: ${code}; ${errors}`)); });
  });
  return { url, output, async stop() { if (child.exitCode !== null) return; const closed = once(child, 'exit'); child.kill(); await closed; } };
}

test('Авторизация и постоянные сессии SQLite', async (t) => {
  const db = openDatabase(databasePath);
  t.after(() => db.close());
  const accounts = await createDemoUsers(db);
  assert.equal(accounts.length, 3);
  let server = await startServer();
  t.after(() => server.stop());

  const request = (route, { cookie, method = 'GET', body, headers = {}, raw } = {}) => fetch(`${server.url}/api${route}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Tochka-Request': '1' } : {}), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const login = async (account, cookie) => {
    const response = await request('/auth/login', { method: 'POST', body: { login: account.login, password: account.password }, cookie });
    assert.equal(response.status, 200);
    return { response, cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json() };
  };
  const cookies = {};

  await t.test('Миграции, соль, стойкий хеш и повторное создание без перезаписи', async () => {
    const before = db.prepare('SELECT * FROM users ORDER BY id').all();
    assert.equal(before.length, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM roles').get().count, 2);
    for (const [index, row] of before.entries()) {
      assert.match(row.password_hash, /^scrypt\$131072\$8\$1\$/);
      assert.ok(!row.password_hash.includes(accounts[index].password));
      assert.equal(await verifyPassword(accounts[index].password, row.password_hash), true);
      assert.equal(await verifyPassword(randomBytes(20).toString('hex'), row.password_hash), false);
    }
    assert.notEqual(await hashPassword(accounts[0].password), before[0].password_hash);
    assert.deepEqual(await createDemoUsers(db), []);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), before);
    const second = openDatabase(databasePath);
    assert.ok(second.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('001-auth.sql'));
    second.close();
  });

  await t.test('Без сессии приватные маршруты закрыты; health работает', async () => {
    assert.equal((await request('/health')).status, 200);
    for (const route of ['/auth/me', '/student', '/staff', `/users/${accounts[0].id}`]) {
      const response = await request(route);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('set-cookie'), null);
    }
    assert.equal((await request('/missing')).status, 404);
  });

  await t.test('Неверные пароли, неизвестный логин и входные данные', async () => {
    const failed = await request('/auth/login', { method: 'POST', body: { login: accounts[0].login, password: randomBytes(20).toString('hex') } });
    assert.equal(failed.status, 401);
    const unknown = await request('/auth/login', { method: 'POST', body: { login: 'unknown', password: randomBytes(20).toString('hex') } });
    assert.equal(unknown.status, 401);
    assert.deepEqual(await failed.json(), await unknown.json());
    for (const body of [{ login: 1, password: 'x' }, { login: "' OR 1=1 --", password: 'x' }, {}, { login: 'student1', password: 'x'.repeat(257) }]) {
      assert.equal((await request('/auth/login', { method: 'POST', body })).status, 400);
    }
    assert.equal((await request('/auth/login', { method: 'POST', raw: '{' })).status, 400);
    assert.equal((await request('/auth/login', { method: 'POST', raw: JSON.stringify({ value: 'x'.repeat(9000) }) })).status, 413);
  });

  await t.test('Все три аккаунта, cookie, роли и изоляция профилей', async () => {
    for (const account of accounts) {
      const signed = await login(account);
      cookies[account.login] = signed.cookie;
      const setCookie = signed.response.headers.get('set-cookie');
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Expires=/i);
      assert.equal(signed.data.user.role, account.role);
      assert.equal(signed.data.user.id, account.id);
      assert.ok(!JSON.stringify(signed.data).includes('password'));
      for (const route of ['/auth/me', `/${account.role}`, `/users/${account.id}`]) {
        const response = await request(route, { cookie: signed.cookie });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).user.id, account.id);
      }
      const otherRole = account.role === 'student' ? 'staff' : 'student';
      assert.equal((await request(`/${otherRole}`, { cookie: signed.cookie, headers: { 'X-User-Role': otherRole } })).status, 403);
      for (const other of accounts.filter((item) => item.id !== account.id)) {
        assert.equal((await request(`/users/${other.id}`, { cookie: signed.cookie })).status, 403);
      }
    }
    assert.equal((await request('/student', { cookie: cookies.student1 })).headers.get('set-cookie'), null);
    assert.notEqual(accounts[0].id, accounts[1].id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 3);
  });

  await t.test('Защита от запросов другого сайта и подмены cookie', async () => {
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: cookies.student1, headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: cookies.student1, headers: { 'X-Tochka-Request': '' } })).status, 403);
    assert.equal((await request('/auth/me', { cookie: 'tochka.sid=forged' })).status, 401);
    assert.equal((await request('/auth/me', { cookie: cookies.student1 })).status, 200);
  });

  await t.test('Повторный вход заменяет идентификатор сессии', async () => {
    const old = cookies.student1;
    cookies.student1 = (await login(accounts[0], old)).cookie;
    assert.notEqual(cookies.student1, old);
    assert.equal((await request('/auth/me', { cookie: old })).status, 401);
  });

  await t.test('Пользователи и все три сессии переживают остановку процесса', async () => {
    const before = db.prepare('SELECT * FROM users ORDER BY id').all();
    await server.stop();
    server = await startServer();
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), before);
    for (const account of accounts) {
      const response = await request('/auth/me', { cookie: cookies[account.login] });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).user.id, account.id);
    }
    const signed = await login(accounts[0], cookies.student1);
    cookies.student1 = signed.cookie;
  });

  await t.test('Выход отзывает сессию на сервере, очищает cookie и сохраняется после перезапуска', async () => {
    const response = await request('/auth/logout', { method: 'POST', cookie: cookies.student1 });
    assert.equal(response.status, 204);
    assert.match(response.headers.get('set-cookie'), /tochka.sid=;/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(accounts[0].id).count, 0);
    for (const route of ['/auth/me', '/student', `/users/${accounts[0].id}`]) {
      assert.equal((await request(route, { cookie: cookies.student1 })).status, 401);
    }
    await server.stop();
    server = await startServer();
    assert.equal((await request('/auth/me', { cookie: cookies.student1 })).status, 401);
    assert.equal((await request('/auth/me', { cookie: cookies.student2 })).status, 200);
  });

  await t.test('Истёкшие сессии закрыты', async () => {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, accounts[1].id);
    assert.equal((await request('/auth/me', { cookie: cookies.student2 })).status, 401);
    assert.equal((await request('/auth/logout', { method: 'POST' })).status, 204);
  });

  await t.test('Ограничение перебора паролей', async () => {
    let response;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      response = await request('/auth/login', { method: 'POST', body: { login: 'unknown', password: randomBytes(20).toString('hex') } });
    }
    assert.equal(response.status, 429);
    assert.ok(response.headers.get('retry-after'));
  });

  for (const mode of [{ NODE_ENV: 'production' }, { NODE_ENV: 'development', AMVERA: '1' }]) {
    await t.test(`${mode.AMVERA ? 'Amvera без NODE_ENV=production' : 'Production'} выдаёт Secure cookie только через HTTPS`, async () => {
      await server.stop();
      server = await startServer({ ...mode, APP_ORIGINS: 'https://tochka.example', TRUST_PROXY: '1' });
      assert.match(server.output, /Режим запуска: production/);
      assert.match(server.output, /прослушивание 0\.0\.0\.0/);
      assert.ok(!server.output.includes(secret));
      if (mode.AMVERA) assert.match(server.output, /NODE_ENV=production: false; AMVERA=1: true/);
      const response = await request('/auth/login', {
        method: 'POST', body: { login: accounts[2].login, password: accounts[2].password },
        headers: { Origin: 'https://tochka.example', 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('set-cookie'), /; Secure/);
      assert.match(response.headers.get('set-cookie'), /; HttpOnly/);
      assert.match(response.headers.get('set-cookie'), /; SameSite=Lax/);
      const plain = await request('/auth/login', { method: 'POST', body: { login: accounts[2].login, password: accounts[2].password } });
      assert.equal(plain.headers.get('set-cookie'), null);
    });
  }
});
