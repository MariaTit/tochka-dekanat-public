import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db/database.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'production-tests');
mkdirSync(cache, { recursive: true });
const directory = mkdtempSync(path.join(cache, 'run-'));
const secret = randomBytes(48).toString('base64url');

test('Production: React, API и закрытые файлы на одном сервере', async (t) => {
  const clientDistPath = path.join(directory, 'client', 'dist');
  mkdirSync(path.join(clientDistPath, 'assets'), { recursive: true });
  const html = '<!doctype html><html lang="ru"><body>Тестовая сборка</body></html>';
  writeFileSync(path.join(clientDistPath, 'index.html'), html);
  writeFileSync(path.join(clientDistPath, 'assets', 'app.js'), 'export const demo = true;');
  writeFileSync(path.join(clientDistPath, '.env'), 'TEST_MARKER=private');
  const db = openDatabase(path.join(directory, 'data', 'test.sqlite'));
  const config = { production: true, trustProxy: true, sessionSecret: secret,
    sessionTtlMs: 8 * 60 * 60 * 1000, origins: ['https://tochka.example'], clientDistPath };
  const app = await createApp(db, config);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;

  await t.test('Прямые адреса и обновление всех страниц загружают React', async () => {
    for (const route of ['/', '/login', '/student', '/student/profile', '/student/schedule',
      '/student/grades', '/student/documents', '/student/more', '/staff']) {
      const response = await fetch(`${url}${route}`, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      assert.equal(await response.text(), html);
      assert.equal(response.headers.get('set-cookie'), null);
    }
    const head = await fetch(`${url}/student/documents`, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  });

  await t.test('Собранные ресурсы доступны; неизвестные файлы не получают HTML React', async () => {
    const resource = await fetch(`${url}/assets/app.js`);
    assert.equal(resource.status, 200);
    assert.match(resource.headers.get('content-type'), /javascript/);
    assert.equal(await resource.text(), 'export const demo = true;');
    for (const route of ['/assets/missing.js', '/student/missing.js', '/unknown']) {
      assert.equal((await fetch(`${url}${route}`)).status, 404, route);
    }
    assert.equal((await fetch(`${url}/student`, { method: 'POST' })).status, 404);
  });

  await t.test('API сохраняет JSON, 401/403/404 и защиту изменяющих запросов', async () => {
    assert.deepEqual(await (await fetch(`${url}/api/health`)).json(), { status: 'ok' });
    for (const route of ['/api', '/api/missing', '/api/student/missing', '/api/assets/missing.js']) {
      const response = await fetch(`${url}${route}`);
      assert.equal(response.status, 404, route);
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await fetch(`${url}/api/auth/me`)).status, 401);
    const forbidden = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: {
      Origin: 'https://foreign.example', 'Content-Type': 'application/json', 'X-Tochka-Request': '1',
    }, body: '{}' });
    assert.equal(forbidden.status, 403);
  });

  await t.test('Файлы окружения, SQLite и исходники не обслуживаются как статика', async () => {
    for (const route of ['/.env', '/server/.env', '/server/src/config.js', '/package.json',
      '/server/data/tochka.sqlite', '/data/test.sqlite', '/data/test.sqlite-wal']) {
      assert.equal((await fetch(`${url}${route}`)).status, 404, route);
    }
  });
});

test('Production: окружение, порт, HTTPS origins и отдельный абсолютный путь базы', () => {
  const source = `import { config, validateConfig } from './server/src/config.js';
    validateConfig();
    console.log(JSON.stringify({ host: config.host, port: config.port, databasePath: config.databasePath }));`;
  function inspect(extra = {}) {
    return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root, windowsHide: true, encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', SESSION_SECRET: secret,
        PORT: '3001', DATABASE_PATH: '', APP_ORIGINS: 'https://tochka.example', ...extra },
    });
  }
  const valid = inspect();
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), { host: '0.0.0.0', port: 3001, databasePath: '/data/tochka.sqlite' });
  const localData = path.join(directory, 'other-data', 'test.sqlite');
  const override = inspect({ DATABASE_PATH: localData, PORT: '3101' });
  assert.equal(override.status, 0, override.stderr);
  assert.equal(JSON.parse(override.stdout).databasePath, localData);
  assert.equal(JSON.parse(override.stdout).port, 3101);
  for (const origin of ['', 'http://tochka.example', 'https://', 'https://tochka.example/path',
    'https://tochka.example/', 'https://tochka.example,']) {
    const invalid = inspect({ APP_ORIGINS: origin });
    assert.notEqual(invalid.status, 0, origin);
    assert.match(invalid.stderr, /APP_ORIGINS/);
  }
  for (const env of [{ SESSION_SECRET: '' }, { PORT: 'bad' }, { DATABASE_PATH: 'data/tochka.sqlite' }]) {
    assert.notEqual(inspect(env).status, 0);
  }
  assert.equal(inspect({ APP_ORIGINS: 'https://tochka.example,https://second.example' }).status, 0);
  const development = inspect({ NODE_ENV: 'development', DATABASE_PATH: '', APP_ORIGINS: '' });
  assert.equal(development.status, 0, development.stderr);
  assert.equal(JSON.parse(development.stdout).host, '127.0.0.1');
  assert.equal(JSON.parse(development.stdout).databasePath, path.join(root, 'server', 'data', 'tochka.sqlite'));
});
