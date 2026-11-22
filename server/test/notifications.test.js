import { LEGACY_ATTESTATION_COLUMNS } from './helpers/legacy-grades.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { createLegacyDemoUsers, LEGACY_USER_COLUMNS } from './helpers/legacy-demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';
import { createDemoNotifications } from '../src/services/demo-notifications.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/notifications-tests');
mkdirSync(cache, { recursive: true });

test('Уведомления: миграция, демоданные, API, события и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql', '003-grades.sql', '004-documents.sql', '005-document-processing.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  const accounts = await createLegacyDemoUsers(db);
  const ids = Object.fromEntries(accounts.map((account) => [account.login, account.id]));
  createDemoSchedule(db); createDemoGrades(db);
  for (const login of ['student1', 'student2']) {
    db.prepare("INSERT INTO document_requests (student_id, document_type_code) VALUES (?, 'study_certificate')").run(ids[login]);
  }
  const oldTables = ['users', 'roles', 'sessions', 'schedule_lessons', 'schedule_imports', 'disciplines',
    'student_disciplines', 'current_results', 'attestations', 'grades_imports', 'document_types', 'document_requests'];
  const snapshot = () => Object.fromEntries(oldTables.map((table) => [table, db.prepare(`SELECT ${table === 'users' ? LEGACY_USER_COLUMNS : table === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM ${table} ORDER BY rowid`).all()]));
  const before = snapshot();
  db.close(); db = openDatabase(databasePath);
  t.after(() => db.close());

  await t.test('Миграция не меняет старые данные; повторное открытие не заполняет уведомления', () => {
    assert.deepEqual(snapshot(), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 10);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, 0);
    const second = openDatabase(databasePath); second.close();
    assert.deepEqual(snapshot(), before);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  const secret = randomBytes(48).toString('base64url');
  async function startServer() {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(root, 'server'), windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0',
        NODE_ENV: 'test', AMVERA: '0', TRUST_PROXY: '0', DEMO_INIT_ENABLED: 'false' },
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
  let server = await startServer(); t.after(() => server.stop());
  const cookies = {};
  const request = (route, login, { method = 'GET', body, headers = {} } = {}) => fetch(`${server.url}/api${route}`, {
    method, headers: { Cookie: cookies[login] || '', 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const account of accounts) {
    const response = await request('/auth/login', null, { method: 'POST', body: { login: account.login, password: account.password } });
    assert.equal(response.status, 200);
    cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  const endpoint = '/student/notifications';
  const list = async (login = 'student1') => {
    const response = await request(endpoint, login);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const read = (id, login = 'student1', extra = {}) => request(`${endpoint}/${id}/read`, login, { method: 'PATCH', body: {}, ...extra });
  let commonId, privateId;

  await t.test('Пустой список и отсутствие автоматического заполнения', async () => {
    assert.deepEqual(await list(), { notifications: [], unreadCount: 0 });
  });
  await t.test('Демо: все четыре вида, реальные дисциплины/занятия/заявки, повтор без дубликатов', async () => {
    assert.equal(createDemoNotifications(db), 12);
    assert.equal(createDemoNotifications(db), 0);
    for (const login of ['student1', 'student2']) {
      const { notifications, unreadCount } = await list(login);
      assert.equal(notifications.length, 7); assert.equal(unreadCount, 7);
      assert.deepEqual([...new Set(notifications.map((item) => item.kind))].sort(), ['deadline', 'document', 'news', 'schedule']);
      const group = login === 'student1' ? 'ИС-21' : 'ЭК-22';
      for (const item of notifications.filter((item) => item.kind === 'schedule')) {
        const lesson = db.prepare('SELECT * FROM schedule_lessons WHERE id = ?').get(item.lessonId);
        assert.equal(lesson.group_name, group);
        assert.ok(item.body.includes(lesson.subject) && item.body.includes(lesson.room));
        assert.equal(item.eventAt, `${lesson.lesson_date}T${lesson.start_time}:00+03:00`);
      }
      const document = notifications.find((item) => item.kind === 'document');
      assert.equal(db.prepare('SELECT student_id FROM document_requests WHERE id = ?').get(document.documentRequestId).student_id, ids[login]);
      const deadline = notifications.find((item) => item.kind === 'deadline');
      const discipline = db.prepare(`SELECT d.name FROM student_disciplines s JOIN disciplines d ON d.id = s.discipline_id
        JOIN current_results c ON c.student_discipline_id = s.id WHERE s.student_id = ? AND c.status = 'pending'`).get(ids[login]);
      assert.ok(deadline.body.includes(discipline.name));
      assert.ok(notifications.every((item) => item.isDemo && !item.readAt));
    }
    const one = (await list()).notifications;
    const two = (await list('student2')).notifications;
    commonId = one.find((item) => item.kind === 'news').id;
    privateId = one.find((item) => item.kind === 'deadline').id;
    assert.deepEqual(one.filter((item) => two.some((other) => other.id === item.id)).map((item) => item.kind), ['news', 'news']);
  });
  await t.test('Прочтение сохраняется отдельно для каждого студента, повтор идемпотентен', async () => {
    const response = await read(commonId);
    assert.equal(response.status, 200);
    const { notification } = await response.json(); assert.ok(notification.readAt);
    const repeat = await read(commonId); assert.equal(repeat.status, 200);
    assert.equal((await repeat.json()).notification.readAt, notification.readAt);
    assert.equal((await list()).unreadCount, 6);
    assert.equal((await list('student2')).unreadCount, 7);
    assert.equal(createDemoNotifications(db), 0);
    assert.equal((await list()).notifications.find((item) => item.id === commonId).readAt, notification.readAt);
  });
  await t.test('Чужие личные и групповые сообщения закрыты; валидация, роли и защита запросов', async () => {
    const groupId = (await list()).notifications.find((item) => item.kind === 'schedule').id;
    for (const id of [privateId, groupId, '999999', '-1', 'abc', '01']) assert.equal((await read(id, 'student2')).status, 404);
    for (const login of [undefined, 'staff']) {
      const expected = login ? 403 : 401;
      assert.equal((await request(endpoint, login)).status, expected);
      assert.equal((await read(commonId, login || 'anonymous')).status, expected);
    }
    for (const body of [{ studentId: ids.student2 }, { readAt: '2026-01-01' }, [], null, 'read']) {
      assert.equal((await read(commonId, 'student1', { body })).status, 400);
    }
    assert.equal((await request(`${endpoint}?studentId=${ids.student2}`, 'student1')).status, 400);
    assert.equal((await read(commonId, 'student1', { headers: { Origin: 'https://foreign.invalid' } })).status, 403);
    assert.equal((await read(commonId, 'student1', { headers: { 'X-Tochka-Request': '' } })).status, 403);
    assert.equal((await request(endpoint, 'student1', { method: 'POST', body: {} })).status, 404);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notification_reads').get().n, 1);
  });
  const change = (id, status, rejectionReason) => request(`/staff/documents/requests/${id}/status`, 'staff', {
    method: 'PATCH', body: { status, ...(rejectionReason ? { rejectionReason } : {}) },
  });
  await t.test('Смена каждого статуса создаёт ровно одно личное уведомление; неуспешная смена не создаёт', async () => {
    const before1 = (await list()).notifications.length;
    const before2 = (await list('student2')).notifications.length;
    for (const status of ['in_progress', 'ready']) assert.equal((await change(1, status)).status, 200);
    assert.equal((await change(1, 'ready')).status, 409);
    assert.equal((await change(2, 'rejected', 'Демо: уточните период обучения.')).status, 200);
    const one = await list(); const two = await list('student2');
    assert.equal(one.notifications.length, before1 + 2);
    assert.equal(two.notifications.length, before2 + 1);
    assert.ok(one.notifications[0].body.includes('Готова'));
    assert.ok(two.notifications[0].body.includes('Демо: уточните период обучения.'));
    assert.ok(one.notifications[0].important && !one.notifications[0].readAt);
    assert.equal((await request('/student/documents/requests/2', 'student1')).status, 404);
  });
  await t.test('Ошибка записи уведомления откатывает новый статус заявки', async () => {
    const result = db.prepare("INSERT INTO document_requests (student_id, document_type_code) VALUES (?, 'study_certificate')").run(ids.student1);
    const id = Number(result.lastInsertRowid);
    const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
    db.exec("CREATE TRIGGER test_notification_failure BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'test'); END");
    try { assert.equal((await change(id, 'in_progress')).status, 500); }
    finally { db.exec('DROP TRIGGER test_notification_failure'); }
    assert.equal(db.prepare('SELECT status FROM document_requests WHERE id = ?').get(id).status, 'submitted');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, beforeCount);
  });
  await t.test('Изменение и отмена занятия уведомляют свою группу без дубликатов при пустом обновлении', async () => {
    const before1 = (await list()).notifications.length;
    const before2 = (await list('student2')).notifications.length;
    const lesson = db.prepare("SELECT id FROM schedule_lessons WHERE group_name = 'ИС-21' AND status = 'scheduled' LIMIT 1").get();
    db.prepare("UPDATE schedule_lessons SET status = 'changed', room = 'Демо-404', change_note = 'Демо: новая аудитория.' WHERE id = ?").run(lesson.id);
    db.prepare("UPDATE schedule_lessons SET status = 'cancelled', change_note = 'Демо: отмена.' WHERE id = ?").run(lesson.id);
    db.prepare('UPDATE schedule_lessons SET room = room WHERE id = ?').run(lesson.id);
    const one = await list(); assert.equal(one.notifications.length, before1 + 2);
    assert.equal((await list('student2')).notifications.length, before2);
    assert.equal(one.notifications[0].title, 'Занятие отменено');
    assert.ok(one.notifications[1].body.includes('Демо-404'));
  });
  await t.test('Настоящий перезапуск сохраняет сессии, сообщения и прочтение; старые модули доступны', async () => {
    const one = await list(); const two = await list('student2');
    await server.stop(); server = await startServer();
    assert.deepEqual(await list(), one); assert.deepEqual(await list('student2'), two);
    for (const login of ['student1', 'student2']) {
      for (const route of ['/auth/me', '/student/grades', '/student/schedule?from=2026-11-20&to=2026-11-28', '/student/documents/requests']) {
        assert.equal((await request(route, login)).status, 200);
      }
    }
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  await t.test('Выход и истечение сессии закрывают список и отметку прочтения', async () => {
    assert.equal((await request('/auth/logout', 'student1', { method: 'POST' })).status, 204);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, ids.student2);
    for (const login of ['student1', 'student2']) {
      assert.equal((await request(endpoint, login)).status, 401);
      assert.equal((await read(commonId, login)).status, 401);
    }
  });
});
