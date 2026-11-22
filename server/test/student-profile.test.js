import { LEGACY_ATTESTATION_COLUMNS } from './helpers/legacy-grades.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { createApp } from '../src/app.js';
import { createDemoUsers } from '../src/services/demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';
import { createDemoNotifications } from '../src/services/demo-notifications.js';
import { findUserById } from '../src/services/users.js';
import { createLegacyDemoUsers, LEGACY_USER_COLUMNS } from './helpers/legacy-demo-users.js';

const cache = fileURLToPath(new URL('../../.cache/student-profile-tests/', import.meta.url));
mkdirSync(cache, { recursive: true });
const newPath = () => path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
const programs = {
  student1: '09.03.02 Информационные системы и технологии',
  student2: '38.03.01 Экономика',
};
function legacyDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql', '003-grades.sql', '004-documents.sql', '005-document-processing.sql', '006-notifications.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  return db;
}
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT ${name === 'users' ? LEGACY_USER_COLUMNS : name === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM "${name}" ORDER BY rowid`).all()]));

test('Профиль: миграция существующей SQLite сохраняет все данные, включая прочтение', async (t) => {
  const filename = newPath();
  let db = legacyDatabase(filename);
  const accounts = await createLegacyDemoUsers(db);
  createDemoSchedule(db); createDemoGrades(db);
  const student = accounts[0];
  db.prepare("UPDATE users SET login = 'STUDENT1', full_name = 'Вымышленный сохранённый профиль' WHERE id = ?").run(student.id);
  db.prepare("INSERT INTO document_requests (student_id, document_type_code) VALUES (?, 'study_certificate')").run(student.id);
  db.prepare("UPDATE document_requests SET status = 'rejected', rejection_reason = 'Демо: уточните период' WHERE student_id = ?").run(student.id);
  createDemoNotifications(db);
  const notification = db.prepare("SELECT id FROM notifications WHERE recipient_id IS NULL AND group_name IS NULL LIMIT 1").get();
  db.prepare('INSERT INTO notification_reads (notification_id, student_id) VALUES (?, ?)').run(notification.id, student.id);
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(randomBytes(24).toString('hex'), student.id, '{}', Date.now() + 3600000);
  const before = snapshot(db);
  db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.deepEqual(snapshot(db), before);
  for (const account of accounts.filter((item) => item.role === 'student')) {
    const user = findUserById(db, account.id);
    assert.equal(user.studyProgram, programs[account.login]);
    assert.equal(user.course, 2);
    for (const key of ['fullName', 'department', 'studyProgram', 'studentGroup']) assert.ok(user[key]?.trim());
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 9);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.prepare('UPDATE users SET course = 3, study_program = ? WHERE id = ?').run('Демо: сохранённое направление', student.id);
  const after = db.prepare('SELECT * FROM users ORDER BY id').all();
  const second = openDatabase(filename); second.close();
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), after);
  assert.deepEqual(await createDemoUsers(db), []);
  assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), after);
  assert.deepEqual(snapshot(db), before);
});

test('Профиль: миграция не выдумывает сведения для других ролей, групп и институтов', async (t) => {
  const filename = newPath();
  let db = legacyDatabase(filename);
  const accounts = await createLegacyDemoUsers(db);
  db.prepare("UPDATE users SET department = 'Другой демоинститут' WHERE login = 'student1'").run();
  db.prepare("UPDATE users SET student_group = 'ДЕМО-99' WHERE login = 'student2'").run();
  const before = snapshot(db);
  db.close(); db = openDatabase(filename);
  t.after(() => db.close());
  assert.deepEqual(snapshot(db), before);
  for (const account of accounts) {
    const user = findUserById(db, account.id);
    assert.equal(user.studyProgram, null); assert.equal(user.course, null);
  }
});

test('Профиль: сбой заполнения откатывает миграцию целиком, повтор возможен', async (t) => {
  const filename = newPath();
  let db = legacyDatabase(filename);
  await createLegacyDemoUsers(db);
  db.exec("CREATE TRIGGER fail_profile BEFORE UPDATE ON users BEGIN SELECT RAISE(ABORT, 'profile-test-failure'); END");
  const before = snapshot(db);
  db.close();
  assert.throws(() => openDatabase(filename), /profile-test-failure/);
  db = new DatabaseSync(filename);
  assert.deepEqual(snapshot(db), before);
  assert.equal(db.prepare('PRAGMA table_info(users)').all().some((column) => column.name === 'course'), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 6);
  // Убирается только искусственный триггер ошибки в отдельной тестовой базе.
  db.exec('DROP TRIGGER fail_profile'); db.close();
  db = openDatabase(filename);
  t.after(() => db.close());
  assert.equal(db.prepare("SELECT course FROM users WHERE login = 'student1'").get().course, 2);
});

test('Профиль: новая база, полные демопрофили и ограничения SQLite', async (t) => {
  const db = openDatabase(newPath());
  t.after(() => db.close());
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  const accounts = await createDemoUsers(db);
  for (const account of accounts) {
    const user = findUserById(db, account.id);
    assert.equal(user.studyProgram, programs[account.login] ?? null);
    assert.equal(user.course, account.role === 'student' ? 2 : null);
  }
  for (const course of [0, 7, -1, 1.5, 'второй']) {
    assert.throws(() => db.prepare('UPDATE users SET course = ? WHERE id = ?').run(course, accounts[0].id), /CHECK constraint/);
  }
  assert.throws(() => db.prepare("UPDATE users SET study_program = '  ' WHERE id = ?").run(accounts[0].id), /CHECK constraint/);
  db.prepare('UPDATE users SET course = NULL, study_program = NULL WHERE id = ?').run(accounts[0].id);
  assert.equal(findUserById(db, accounts[0].id).course, null);
});

test('Профиль: API обоих студентов, изоляция, прежние пароли и сессии после повторного открытия', async (t) => {
  const filename = newPath();
  let db = legacyDatabase(filename);
  const accounts = await createLegacyDemoUsers(db);
  const credentialsBefore = db.prepare(`SELECT ${LEGACY_USER_COLUMNS} FROM users ORDER BY id`).all();
  db.close(); db = openDatabase(filename);
  const config = { sessionSecret: randomBytes(48).toString('base64url'), sessionTtlMs: 3600000,
    production: false, trustProxy: false, origins: ['http://127.0.0.1'] };
  let server;
  let origin;
  const start = async () => {
    const app = await createApp(db, config);
    server = await new Promise((resolve) => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    origin = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  t.after(async () => { await stop(); db.close(); });
  await start();
  const request = (route, cookie) => fetch(`${origin}/api${route}`, { headers: cookie ? { Cookie: cookie } : {} });
  assert.equal((await request('/auth/me')).status, 401);
  const cookies = {};
  for (const account of accounts) {
    const response = await fetch(`${origin}/api/auth/login`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tochka-Request': '1' },
      body: JSON.stringify({ login: account.login, password: account.password }) });
    assert.equal(response.status, 200);
    cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
    const user = (await response.json()).user;
    assert.equal(user.studyProgram, programs[account.login] ?? null);
    assert.equal(user.course, account.role === 'student' ? 2 : null);
    assert.ok(!JSON.stringify(user).includes('password'));
  }
  async function checkProfiles() {
    for (const account of accounts.filter((item) => item.role === 'student')) {
      for (const route of ['/auth/me', '/student', `/users/${account.id}`]) {
        const response = await request(route, cookies[account.login]);
        assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
        const user = (await response.json()).user;
        assert.equal(user.id, account.id); assert.equal(user.studyProgram, programs[account.login]); assert.equal(user.course, 2);
      }
      for (const other of accounts.filter((item) => item.id !== account.id)) {
        assert.equal((await request(`/users/${other.id}`, cookies[account.login])).status, 403);
      }
    }
    assert.equal((await request('/student', cookies.staff)).status, 403);
    assert.equal((await request(`/users/${accounts[0].id}`, cookies.staff)).status, 403);
  }
  await checkProfiles();
  const sessions = db.prepare('SELECT * FROM sessions ORDER BY sid').all();
  await stop(); db.close(); db = openDatabase(filename); await start();
  await checkProfiles();
  assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY sid').all(), sessions);
  assert.deepEqual(db.prepare(`SELECT ${LEGACY_USER_COLUMNS} FROM users ORDER BY id`).all(), credentialsBefore);
});
