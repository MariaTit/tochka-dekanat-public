import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { createDemoUsers } from '../src/services/demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'grades-tests');
mkdirSync(cache, { recursive: true });

test('Оценки: миграция существующей базы, изоляция, результаты и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  // Имитируем базу предыдущего блока с пользователями, расписанием и живой сессией.
  let db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  const accounts = await createDemoUsers(db);
  createDemoSchedule(db);
  const studentId = accounts.find((account) => account.login === 'student1').id;
  const marker = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(marker, studentId, JSON.stringify({ marker }), Date.now() + 3600000);
  const snapshot = () => Object.fromEntries(['users', 'sessions', 'schedule_lessons', 'schedule_imports']
    .map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()]));
  const legacy = snapshot();
  db.close();
  db = openDatabase(databasePath);
  t.after(() => db.close());

  await t.test('Новая миграция сохраняет прежние данные, хеши паролей и сессии', () => {
    assert.deepEqual(snapshot(), legacy);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 3);
    for (const table of ['disciplines', 'student_disciplines', 'current_results', 'attestations']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  });

  const secret = randomBytes(48).toString('base64url');
  async function startServer() {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(root, 'server'), windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0', NODE_ENV: 'test', TRUST_PROXY: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Сервер не запустился')); }, 15000);
      const read = (chunk) => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      };
      child.stdout.on('data', read); child.stderr.on('data', read);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Сервер завершился: ${code}`)); });
    });
    return { url, async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'exit'); child.kill(); await closed;
    } };
  }
  let server = await startServer();
  t.after(() => server.stop());
  const request = (route, cookie, options = {}) => fetch(`${server.url}/api${route}`, {
    ...options, headers: { Cookie: cookie || '', 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...options.headers },
  });
  const cookies = {};
  for (const account of accounts) {
    const response = await request('/auth/login', null, { method: 'POST', body: JSON.stringify({ login: account.login, password: account.password }) });
    assert.equal(response.status, 200);
    cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  const endpoint = '/student/grades';
  await t.test('Пустые данные не подменяются деморезультатами при запуске сервера', async () => {
    assert.deepEqual(await (await request(endpoint, cookies.student1)).json(), { disciplines: [] });
  });

  await t.test('Однократная подготовка не меняет пользователей, сессии и расписание', () => {
    const before = snapshot();
    assert.equal(createDemoGrades(db), 16);
    assert.deepEqual(snapshot(), before);
    const grades = db.prepare('SELECT * FROM current_results ORDER BY id').all();
    assert.equal(createDemoGrades(db), 0);
    assert.deepEqual(db.prepare('SELECT * FROM current_results ORDER BY id').all(), grades);
    assert.deepEqual(snapshot(), before);
  });

  await t.test('Доступ закрыт без сессии, с поддельной cookie и для сотрудника', async () => {
    assert.equal((await request(endpoint)).status, 401);
    assert.equal((await request(endpoint, 'tochka.sid=forged')).status, 401);
    assert.equal((await request(endpoint, cookies.staff)).status, 403);
  });

  const results = {};
  await t.test('У каждого студента свои дисциплины и результаты; приватные ответы не кешируются', async () => {
    for (const login of ['student1', 'student2']) {
      const response = await request(endpoint, cookies[login]);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      results[login] = await response.json();
      assert.equal(results[login].disciplines.length, 4);
      assert.ok(!JSON.stringify(results[login]).includes('password'));
      for (const discipline of results[login].disciplines) {
        assert.equal(discipline.isDemo, true);
        assert.match(discipline.name, /^Демо:/);
        assert.ok(discipline.period);
        assert.equal(discipline.currentResults.length, 1);
        assert.equal(discipline.attestations.length, 1);
      }
    }
    const first = results.student1.disciplines.map((discipline) => discipline.name);
    assert.ok(results.student2.disciplines.every((discipline) => !first.includes(discipline.name)));
    assert.equal(results.student1.disciplines[0].attestations[0].result, '5');
    assert.equal(results.student2.disciplines[0].attestations[0].result, '3');
  });

  await t.test('Подмена владельца в параметрах, пути, теле и заголовке не раскрывает чужие результаты', async () => {
    const foreignId = accounts.find((account) => account.login === 'student2').id;
    for (const query of [`userId=${foreignId}`, `studentId=${foreignId}`, `id=${foreignId}`, 'group=ЭК-22', 'userId[]=2', 'userId=1&userId=2']) {
      assert.equal((await request(`${endpoint}?${encodeURI(query)}`, cookies.student1)).status, 400);
    }
    for (const route of [`${endpoint}/${foreignId}`, `/users/${foreignId}/grades`, `/student/${foreignId}/grades`]) {
      assert.equal((await request(route, cookies.student1)).status, 404);
    }
    const response = await request(endpoint, cookies.student1, { headers: { 'X-Student-Id': String(foreignId), 'X-User-Id': String(foreignId) } });
    assert.deepEqual(await response.json(), results.student1);
  });

  await t.test('Ноль отличается от null; зачёты, экзамены и шкалы возвращаются без выдуманных показателей', () => {
    const all = Object.values(results).flatMap((data) => data.disciplines);
    const current = all.flatMap((discipline) => discipline.currentResults);
    const final = all.flatMap((discipline) => discipline.attestations);
    assert.ok(current.some((result) => result.points === 0 && result.status === 'published'));
    assert.ok(current.some((result) => result.points === null && result.status === 'pending'));
    assert.ok(final.some((result) => result.type === 'exam' && result.result === '4'));
    assert.ok(final.some((result) => result.type === 'credit' && result.result === 'Зачтено'));
    assert.ok(final.some((result) => result.result === null && result.status === 'pending'));
    for (const result of current) { assert.equal(result.maxPoints, 20); assert.match(result.scaleRules, /от 0 до 20/); }
    for (const result of final) assert.ok(result.gradingRules);
    for (const data of Object.values(results)) assert.deepEqual(Object.keys(data), ['disciplines']);
  });

  await t.test('База запрещает баллы за пределами шкалы и несовместимые статусы или результаты', () => {
    const currentId = results.student1.disciplines[0].currentResults[0].id;
    for (const points of [-1, 21, null]) assert.throws(() => db.prepare('UPDATE current_results SET points = ? WHERE id = ?').run(points, currentId));
    assert.throws(() => db.prepare("UPDATE current_results SET status = 'pending' WHERE id = ?").run(currentId));
    const finalId = results.student1.disciplines[0].attestations[0].id;
    for (const value of ['6', 'Зачтено', null]) assert.throws(() => db.prepare('UPDATE attestations SET result = ? WHERE id = ?').run(value, finalId));
  });

  await t.test('Для обеих ролей отсутствуют API создания, редактирования и удаления оценок', async () => {
    const before = db.prepare('SELECT * FROM current_results ORDER BY id').all();
    for (const login of ['student1', 'staff']) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        for (const route of [endpoint, `${endpoint}/1`]) {
          assert.equal((await request(route, cookies[login], { method, body: JSON.stringify({ studentId: 2, points: 20 }) })).status,
            login === 'staff' ? 403 : 404);
        }
      }
    }
    assert.deepEqual(db.prepare('SELECT * FROM current_results ORDER BY id').all(), before);
  });

  await t.test('Известные оценки, дисциплина без результатов и сессии сохраняются после перезапуска процесса', async () => {
    const currentId = results.student1.disciplines[0].currentResults[0].id;
    db.prepare('UPDATE current_results SET points = 7 WHERE id = ?').run(currentId);
    const disciplineId = Number(db.prepare("INSERT INTO disciplines (name) VALUES ('Демо: ещё без результатов')").run().lastInsertRowid);
    db.prepare("INSERT INTO student_disciplines (student_id, discipline_id, period, is_demo) VALUES (?, ?, 'Демо', 1)").run(studentId, disciplineId);
    const before = await (await request(endpoint, cookies.student1)).json();
    assert.deepEqual(before.disciplines.at(-1).currentResults, []);
    assert.deepEqual(before.disciplines.at(-1).attestations, []);
    await server.stop();
    server = await startServer();
    assert.equal(createDemoGrades(db), 0);
    assert.deepEqual(await (await request(endpoint, cookies.student1)).json(), before);
    assert.equal(before.disciplines[0].currentResults[0].points, 7);
    assert.deepEqual(await (await request(endpoint, cookies.student2)).json(), results.student2);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), legacy.users);
    assert.deepEqual(db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all(), legacy.schedule_lessons);
    assert.equal((await request('/auth/me', cookies.student1)).status, 200);
    assert.equal((await request('/student/schedule?from=2026-11-20&to=2026-11-28', cookies.student1)).status, 200);
    assert.equal((await request('/auth/logout', cookies.student1, { method: 'POST' })).status, 204);
    assert.equal((await request(endpoint, cookies.student1)).status, 401);
    assert.equal((await request('/student/schedule/upcoming', cookies.student1)).status, 401);
  });
});

test('Подготовка без нужных студентов прерывается без частичного заполнения', () => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'empty-')), 'test.sqlite');
  const db = openDatabase(databasePath);
  try {
    assert.throws(() => createDemoGrades(db), /student1/);
    for (const table of ['disciplines', 'student_disciplines', 'current_results', 'attestations', 'grades_imports']) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
  } finally { db.close(); }
});
