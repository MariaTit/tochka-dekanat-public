import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { openDatabase } from '../src/db/database.js';
import { initializeDemoData } from '../src/services/demo-initialization.js';
import { hashPassword, verifyPassword } from '../src/services/passwords.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'demo-initialization-tests');
mkdirSync(cache, { recursive: true });
const secret = () => randomBytes(32).toString('base64url');
const credentials = () => ({ DEMO_INIT_ENABLED: 'true', DEMO_STUDENT1_PASSWORD: secret(),
  DEMO_STUDENT2_PASSWORD: secret(), DEMO_STAFF_PASSWORD: secret() });
const newPath = () => path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));

function launch(databasePath, extra = {}, script = 'src/index.js') {
  const child = spawn(process.execPath, [script], {
    cwd: path.join(root, 'server'), windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', AMVERA: '1', PORT: '0', TRUST_PROXY: '1',
      DATABASE_PATH: databasePath, APP_ORIGINS: 'https://tochka.example', SESSION_SECRET: secret(),
      DEMO_INIT_ENABLED: '', DEMO_STUDENT1_PASSWORD: '', DEMO_STUDENT2_PASSWORD: '', DEMO_STAFF_PASSWORD: '', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const closed = once(child, 'exit');
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Истекло время запуска')); }, 30000);
    child.stdout.on('data', () => {
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Сервер не запустился')); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  // У короткой команды setup нет строки запуска сервера.
  ready.catch(() => {});
  return { ready, closed, get output() { return output; },
    async stop() { if (child.exitCode === null) child.kill(); await closed; } };
}

function noSecrets(output, values) {
  for (const value of values) assert.ok(!output.includes(value), 'В лог попало секретное значение');
  assert.ok(!output.includes('scrypt$'), 'В лог попал хеш');
}

test('Демоданные выключены по умолчанию; только точное true разрешает запись', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  const before = snapshot(db);
  for (const flag of [undefined, '', 'false', '1', 'TRUE', ' true ']) {
    assert.equal(await initializeDemoData(db, { ...credentials(), DEMO_INIT_ENABLED: flag }), undefined);
    assert.deepEqual(snapshot(db), before);
  }
});

test('Все недостающие пароли проверяются до записи; значения не попадают в ошибки', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  const before = snapshot(db);
  for (const invalid of [undefined, '', 'short', ' '.repeat(12), secret().repeat(7)]) {
    const env = { ...credentials(), DEMO_STAFF_PASSWORD: invalid };
    await assert.rejects(initializeDemoData(db, env), (error) => {
      assert.match(error.message, /DEMO_STAFF_PASSWORD/);
      noSecrets(error.message, [env.DEMO_STUDENT1_PASSWORD, env.DEMO_STUDENT2_PASSWORD]);
      return true;
    });
    assert.deepEqual(snapshot(db), before);
  }
});

test('Ошибка вставки откатывает всех новых пользователей; существующие данные сохраняются', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_demo_user BEFORE INSERT ON users WHEN NEW.login = 'staff' BEGIN SELECT RAISE(ABORT, 'private-field-error'); END");
  const before = snapshot(db);
  await assert.rejects(initializeDemoData(db, credentials()));
  assert.deepEqual(snapshot(db), before);
});

test('Частично заполненная база: существующий логин без учёта регистра, его пароль, профиль, сессия и заявка сохраняются', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  const password = secret();
  db.prepare(`INSERT INTO users (login, password_hash, role_id, full_name, email, student_group, department)
    VALUES ('STUDENT1', ?, (SELECT id FROM roles WHERE name = 'student'), 'Вымышленный прежний профиль', 'saved@example.test', 'ИС-21', 'Демо-институт')`)
    .run(await hashPassword(password));
  const user = db.prepare('SELECT * FROM users').get();
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(secret(), user.id, '{}', Date.now() + 3600000);
  db.prepare(`INSERT INTO document_requests (student_id, document_type_code, comment, status)
    VALUES (?, 'study_certificate', 'Сохранённая вымышленная заявка', 'submitted')`).run(user.id);
  const sessions = db.prepare('SELECT * FROM sessions').all();
  const documents = db.prepare('SELECT * FROM document_requests').all();
  const env = credentials();
  delete env.DEMO_STUDENT1_PASSWORD;
  assert.deepEqual(await initializeDemoData(db, env), { users: 2, lessons: 32, results: 16 });
  assert.deepEqual(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), user);
  assert.equal(await verifyPassword(password, user.password_hash), true);
  assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), sessions);
  assert.deepEqual(db.prepare('SELECT * FROM document_requests').all(), documents);
});

test('После сбоя оценок повторный запуск завершает импорт без дублирования пользователей и расписания', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  db.exec("CREATE TRIGGER fail_demo_grade BEFORE INSERT ON current_results BEGIN SELECT RAISE(ABORT, 'private-field-error'); END");
  await assert.rejects(initializeDemoData(db, credentials()));
  const users = db.prepare('SELECT * FROM users ORDER BY id').all();
  const lessons = db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all();
  assert.equal(users.length, 3);
  assert.equal(lessons.length, 32);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM disciplines').get().n, 0);
  // Удаляется только искусственный триггер ошибки в отдельной тестовой базе.
  db.exec('DROP TRIGGER fail_demo_grade');
  assert.deepEqual(await initializeDemoData(db, { DEMO_INIT_ENABLED: 'true' }), { users: 0, lessons: 0, results: 16 });
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), users);
  assert.deepEqual(db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all(), lessons);
});

test('Облачный запуск, вход всех аккаунтов, документы и перезапуск после отключения инициализации', async (t) => {
  const databasePath = newPath();
  const db = openDatabase(databasePath);
  t.after(() => db.close());
  const birthtime = statSync(databasePath).birthtimeMs;
  assert.ok(existsSync(`${databasePath}-wal`));
  assert.ok(existsSync(`${databasePath}-shm`));
  const env = { ...credentials(), SESSION_SECRET: secret() };
  let server = launch(databasePath, env);
  t.after(() => server.stop());
  let url = await server.ready;
  assert.match(server.output, /новых пользователей — 3; занятий — 32; результатов — 16/);
  const request = (route, { method = 'GET', body, cookie } = {}) => fetch(`${url}/api${route}`, {
    method, headers: { 'X-Forwarded-Proto': 'https', 'X-Tochka-Request': '1',
      'Content-Type': 'application/json', Origin: 'https://tochka.example', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const cookies = {};
  for (const login of ['student1', 'student2', 'staff']) {
    const response = await request('/auth/login', { method: 'POST', body: { login, password: env[`DEMO_${login.toUpperCase()}_PASSWORD`] } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('set-cookie'), /Secure/);
    assert.match(response.headers.get('set-cookie'), /HttpOnly/);
    cookies[login] = response.headers.get('set-cookie').split(';')[0];
    if (login !== 'staff') {
      const schedule = await request('/student/schedule?from=2026-11-20&to=2026-11-28', { cookie: cookies[login] });
      assert.equal(schedule.status, 200);
      assert.ok((await schedule.json()).lessons.length > 0);
      const grades = await request('/student/grades', { cookie: cookies[login] });
      assert.equal(grades.status, 200);
      assert.ok((await grades.json()).disciplines.length > 0);
    }
  }
  const created = await request('/student/documents/requests', { method: 'POST', cookie: cookies.student1,
    body: { documentTypeCode: 'study_certificate', comment: 'Вымышленная заявка' } });
  assert.equal(created.status, 201);
  const document = (await created.json()).request;
  const changed = await request(`/staff/documents/requests/${document.id}/status`, { method: 'PATCH', cookie: cookies.staff, body: { status: 'in_progress' } });
  assert.equal(changed.status, 200);
  assert.equal((await request(`/student/documents/requests/${document.id}`, { cookie: cookies.student2 })).status, 404);
  for (const route of ['/setup', '/auth/setup', '/setup-demo']) assert.equal((await request(route, { method: 'POST', body: {} })).status, 404);
  await server.stop();
  noSecrets(server.output, Object.values(env).filter((value) => value !== 'true'));
  db.exec("UPDATE users SET full_name = 'Вымышленный сохранённый профиль' WHERE login = 'student1'; UPDATE schedule_lessons SET room = 'Демо-сохранено' WHERE id = 1; UPDATE current_results SET points = 7 WHERE id = 1;");
  const before = snapshot(db);
  // Повтор при оставленном флаге: новые секреты не заменяют существующие пароли.
  server = launch(databasePath, { ...credentials(), SESSION_SECRET: env.SESSION_SECRET });
  url = await server.ready;
  assert.match(server.output, /новых пользователей — 0; занятий — 0; результатов — 0/);
  await server.stop();
  assert.deepEqual(snapshot(db), before);
  // Отключение флага и удаление трёх паролей сохраняет данные и сессии.
  server = launch(databasePath, { SESSION_SECRET: env.SESSION_SECRET });
  url = await server.ready;
  assert.match(server.output, /Демоинициализация отключена/);
  assert.deepEqual(snapshot(db), before);
  for (const cookie of Object.values(cookies)) assert.equal((await request('/auth/me', { cookie })).status, 200);
  assert.equal((await request(`/student/documents/requests/${document.id}`, { cookie: cookies.student1 })).status, 200);
  assert.equal(db.prepare('SELECT status FROM document_requests WHERE id = ?').get(document.id).status, 'in_progress');
  assert.equal(statSync(databasePath).birthtimeMs, birthtime);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('Production setup требует флаг, не пишет .env и не раскрывает секреты при успехе и сбое', async (t) => {
  const databasePath = newPath();
  const db = openDatabase(databasePath);
  t.after(() => db.close());
  const envPath = path.join(root, 'server', '.env');
  const beforeEnv = existsSync(envPath) ? readFileSync(envPath, 'utf8') : null;
  const before = snapshot(db);
  let command = launch(databasePath, {}, 'scripts/setup-demo.js');
  assert.equal((await command.closed)[0], 0);
  assert.deepEqual(snapshot(db), before);
  assert.match(command.output, /Демоинициализация отключена/);
  const env = credentials();
  command = launch(databasePath, env, 'scripts/setup-demo.js');
  assert.equal((await command.closed)[0], 0);
  noSecrets(command.output, [env.DEMO_STUDENT1_PASSWORD, env.DEMO_STUDENT2_PASSWORD, env.DEMO_STAFF_PASSWORD]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
  const failedPath = newPath();
  command = launch(failedPath, { ...env, DEMO_STAFF_PASSWORD: 'short' });
  assert.equal((await command.closed)[0], 1);
  assert.match(command.output, /Демоинициализация не завершена/);
  assert.ok(!command.output.includes('Сервер «Точка» запущен'));
  noSecrets(command.output, [env.DEMO_STUDENT1_PASSWORD, env.DEMO_STUDENT2_PASSWORD, 'short']);
  assert.equal(existsSync(envPath) ? readFileSync(envPath, 'utf8') : null, beforeEnv);
});
