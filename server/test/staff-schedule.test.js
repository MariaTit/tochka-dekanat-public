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
import { createDemoUsers } from '../src/services/demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';
import { createDemoNotifications } from '../src/services/demo-notifications.js';
import { getScheduleGroups } from '../src/services/staff-schedule.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/staff-schedule-tests');
mkdirSync(cache, { recursive: true });
const snapshot = (db) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT ${name === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM "${name}" ORDER BY rowid`).all()]));

test('Управление расписанием: миграция, права, события, студенты и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql', '003-grades.sql', '004-documents.sql', '005-document-processing.sql', '006-notifications.sql', '007-student-profile.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  const accounts = await createDemoUsers(db);
  createDemoSchedule(db); createDemoGrades(db); createDemoNotifications(db);
  const student = db.prepare("SELECT * FROM users WHERE login = 'student1'").get();
  // Второй вымышленный студент той же группы проверяет общее уведомление и личное прочтение.
  for (const [login, group, department, course] of [['peer', student.student_group, student.department, 2], ['unknown', 'ДЕМО-99', '', null]]) {
    db.prepare(`INSERT INTO users (login, password_hash, role_id, full_name, email, student_group, department, course)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(login, student.password_hash, student.role_id, 'Вымышленный студент', `${login}@example.test`, group, department, course);
    if (login === 'peer') accounts.push({ login, password: accounts.find((item) => item.login === 'student1').password });
  }
  db.prepare('INSERT INTO notification_reads (notification_id, student_id) VALUES (?, ?)')
    .run(db.prepare('SELECT id FROM notifications ORDER BY id LIMIT 1').get().id, student.id);
  const before = snapshot(db);
  db.close(); db = openDatabase(databasePath);
  t.after(() => db.close());
  await t.test('008 сохраняет все таблицы и прочтение; повтор не создаёт сообщений', () => {
    assert.deepEqual(snapshot(db), before);
    const second = openDatabase(databasePath); second.close();
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 9);
    const empty = openDatabase(':memory:');
    try { assert.deepEqual(getScheduleGroups(empty), []); } finally { empty.close(); }
  });

  const secret = randomBytes(48).toString('base64url');
  async function startServer() {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: path.join(root, 'server'), windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0', NODE_ENV: 'test',
        AMVERA: '0', TRUST_PROXY: '0', DEMO_INIT_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Сервер не запустился')); }, 15000);
      const read = (chunk) => { output += chunk.toString(); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); } };
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
  const request = (route, login = 'staff', { method = 'GET', body, headers = {} } = {}) => fetch(`${server.url}/api${route}`, {
    method, headers: { Cookie: cookies[login] || '', 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const account of accounts) {
    const response = await request('/auth/login', null, { method: 'POST', body: { login: account.login, password: account.password } });
    assert.equal(response.status, 200); cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  const endpoint = '/staff/schedule';
  const range = '?from=2026-11-01&to=2026-12-31';
  const staffRange = `${endpoint}${range}&group=${encodeURIComponent('ИС-21')}`;
  const notifications = async (login = 'student1') => {
    const response = await request('/student/notifications', login); assert.equal(response.status, 200); return response.json();
  };
  const studentSchedule = async (login = 'student1', query = range) => {
    const response = await request(`/student/schedule${query}`, login); assert.equal(response.status, 200); return response.json();
  };
  let fields = { subject: 'Демо: новая дисциплина', date: '2026-11-23', startTime: '10:00', endTime: '11:30',
    room: 'Демо-101', teacher: 'Вымышленный преподаватель', type: 'Лекция' };
  const create = (body = { ...fields, group: 'ИС-21' }, login = 'staff', headers) => request(endpoint, login, { method: 'POST', body, headers });
  const edit = (id, body = fields) => request(`${endpoint}/${id}`, 'staff', { method: 'PUT', body });
  const status = (id, value) => request(`${endpoint}/${id}/status`, 'staff', { method: 'PATCH', body: { status: value } });
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  let id;

  await t.test('Анониму 401 и студенту 403 на чтение, создание, изменение, отмену и восстановление', async () => {
    const original = snapshot(db);
    for (const [login, expected] of [['anonymous', 401], ['student1', 403]]) {
      for (const [route, method, body] of [[`${endpoint}/groups`, 'GET'], [staffRange, 'GET'], [endpoint, 'POST', { ...fields, group: 'ИС-21' }],
        [`${endpoint}/1`, 'PUT', fields], [`${endpoint}/1/status`, 'PATCH', { status: 'cancelled' }], [`${endpoint}/1/status`, 'PATCH', { status: 'restored' }]]) {
        assert.equal((await request(route, login, { method, body })).status, expected);
      }
    }
    assert.deepEqual(snapshot(db), original);
  });
  await t.test('Факультеты, курсы и группы берутся из профилей; пропуски не выдумываются', async () => {
    const response = await request(`${endpoint}/groups`); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { groups } = await response.json();
    assert.deepEqual(groups, JSON.parse(JSON.stringify(getScheduleGroups(db))));
    assert.equal(groups.length, 3);
    assert.ok(groups.some((item) => item.group === 'ИС-21' && item.course === 2 && item.department === student.department));
    assert.ok(groups.some((item) => item.group === 'ДЕМО-99' && item.course === null && item.department === null));
    assert.equal((await request(`${endpoint}/groups?studentId=1`)).status, 400);
    const empty = await request(`${endpoint}${range}&group=${encodeURIComponent('ДЕМО-99')}`);
    assert.equal(empty.status, 200); assert.equal((await empty.json()).hasSchedule, false);
  });
  await t.test('Некорректные поля, даты, время, типы, группы и подмена статуса отклоняются без записи', async () => {
    const original = snapshot(db);
    const valid = { ...fields, group: 'ИС-21' };
    const invalid = [null, [], 'lesson', {}, ...Object.keys(valid).map((key) => ({ ...valid, [key]: undefined })),
      ...['2026-02-30', '2025-02-29', '2026-13-01', '2026-11-23T00:00:00Z', '1899-12-31', '2101-01-01'].map((date) => ({ ...valid, date })),
      ...['24:00', '9:00', '12:60', '10:00:00', null].map((startTime) => ({ ...valid, startTime })),
      { ...valid, endTime: '10:00' }, { ...valid, endTime: '09:00' }, { ...valid, teacher: '  ' },
      { ...valid, subject: 'x'.repeat(201) }, { ...valid, room: 'x'.repeat(101) }, { ...valid, teacher: 'x'.repeat(201) },
      { ...valid, subject: 'x\u0000x' }, { ...valid, room: 'x\nx' }, { ...valid, type: 'Экзамен' },
      { ...valid, group: 'Нет такой группы' }, { ...valid, group: ['ИС-21'] }, { ...valid, status: 'cancelled' },
      { ...valid, studentId: student.id }, { ...valid, isDemo: true }];
    for (const body of invalid) assert.equal((await create(body)).status, 400);
    for (const query of ['?group=ИС-21&from=2026-02-30&to=2026-03-01', '?group=ИС-21&from=2026-11-24&to=2026-11-23',
      '?group=ИС-21&from=2026-01-01&to=2026-12-31', '?group=no&from=2026-11-20&to=2026-11-21',
      '?group=ИС-21&group=ЭК-22&from=2026-11-20&to=2026-11-21', `${range}&group=ИС-21&studentId=1`]) {
      assert.equal((await request(endpoint + query)).status, 400);
    }
    assert.equal((await create(valid, 'staff', { Origin: 'https://foreign.invalid' })).status, 403);
    assert.equal((await create(valid, 'staff', { 'X-Tochka-Request': '' })).status, 403);
    assert.equal((await create(valid, 'staff', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.deepEqual(snapshot(db), original);
  });
  await t.test('Создание видно своей группе и обоим её студентам; другое расписание и уведомления не меняются', async () => {
    const otherSchedule = await studentSchedule('student2');
    const otherNotifications = await notifications('student2');
    const n = count();
    const response = await create({ ...fields, subject: `  ${fields.subject}  `, teacher: ` ${fields.teacher} `, group: 'ИС-21' });
    assert.equal(response.status, 201); assert.equal(response.headers.get('cache-control'), 'no-store');
    const { lesson } = await response.json(); id = lesson.id;
    assert.equal(lesson.subject, fields.subject); assert.equal(lesson.teacher, fields.teacher);
    assert.equal(lesson.status, 'scheduled'); assert.equal(lesson.isDemo, false);
    assert.equal(count(), n + 1);
    for (const login of ['student1', 'peer']) {
      assert.deepEqual((await studentSchedule(login)).lessons.find((item) => item.id === id), lesson);
      const notice = (await notifications(login)).notifications[0];
      assert.equal(notice.lessonId, id); assert.equal(notice.title, 'Добавлено занятие'); assert.equal(notice.readAt, null);
      assert.ok(notice.body.includes(fields.teacher) && notice.body.includes(fields.type));
    }
    assert.deepEqual(await studentSchedule('student2'), otherSchedule);
    assert.deepEqual(await notifications('student2'), otherNotifications);
    assert.equal((await request(`/student/schedule/${id}`, 'student2')).status, 404);
    const newNotification = (await notifications()).notifications[0];
    assert.equal((await request(`/student/notifications/${newNotification.id}/read`, 'student1', { method: 'PATCH', body: {} })).status, 200);
    assert.equal((await notifications('peer')).notifications[0].readAt, null);
  });
  await t.test('Редактирование дисциплины, аудитории, преподавателя и типа; пустое сохранение без дубликата', async () => {
    const other = await notifications('student2'); const n = count();
    fields = { ...fields, room: 'Демо-202', teacher: 'Другой вымышленный преподаватель', subject: 'Демо: изменённая дисциплина', type: 'Практика' };
    const response = await edit(id); assert.equal(response.status, 200);
    assert.equal((await response.json()).lesson.status, 'changed');
    const lesson = (await studentSchedule()).lessons.find((item) => item.id === id);
    for (const key of Object.keys(fields)) assert.equal(lesson[key], fields[key]);
    assert.equal(count(), n + 1);
    assert.equal((await (await edit(id)).json()).unchanged, true); assert.equal(count(), n + 1);
    fields = { ...fields, type: 'Семинар' }; assert.equal((await edit(id)).status, 200);
    assert.equal(count(), n + 2); assert.ok((await notifications()).notifications[0].body.includes('Семинар'));
    assert.deepEqual(await notifications('student2'), other);
  });
  await t.test('Перенос даты и времени, повторный перенос и указание исходной даты у студента', async () => {
    const n = count();
    fields = { ...fields, date: '2026-11-30', startTime: '12:00', endTime: '13:30' };
    assert.equal((await edit(id)).status, 200);
    fields = { ...fields, date: '2026-12-01', startTime: '14:00', endTime: '15:30' };
    const response = await edit(id); assert.equal(response.status, 200);
    const { lesson } = await response.json(); assert.equal(lesson.status, 'moved');
    assert.deepEqual(lesson.original, { date: '2026-11-23', startTime: '10:00', endTime: '11:30', room: 'Демо-101' });
    assert.equal((await studentSchedule()).lessons.find((item) => item.id === id).date, '2026-12-01');
    assert.ok((await studentSchedule('student1', '?from=2026-11-23&to=2026-11-23')).lessons.some((item) => item.id === id));
    assert.equal(count(), n + 2); assert.equal((await notifications()).notifications[0].title, 'Занятие перенесено');
  });
  await t.test('Отмена, запрет редактирования отменённого, восстановление с сохранением переноса', async () => {
    const other = await notifications('student2'); const n = count();
    assert.equal((await status(id, 'cancelled')).status, 200);
    assert.equal((await studentSchedule()).lessons.find((item) => item.id === id).status, 'cancelled');
    assert.equal((await status(id, 'cancelled')).status, 409); assert.equal((await edit(id)).status, 409);
    const upcoming = await (await request('/student/schedule/upcoming', 'student1')).json();
    assert.ok(!upcoming.lessons.some((item) => item.id === id));
    const restored = await status(id, 'restored'); assert.equal(restored.status, 200);
    assert.equal((await restored.json()).lesson.status, 'moved');
    assert.equal((await studentSchedule()).lessons.find((item) => item.id === id).date, fields.date);
    assert.equal((await status(id, 'restored')).status, 409); assert.equal(count(), n + 2);
    const notices = (await notifications()).notifications;
    assert.equal(notices[0].title, 'Занятие восстановлено'); assert.equal(notices[1].title, 'Занятие отменено');
    assert.deepEqual(await notifications('student2'), other);
  });
  await t.test('Восстановление обычного занятия и отмена снова сохраняются', async () => {
    const response = await create(); const created = (await response.json()).lesson;
    assert.equal((await status(created.id, 'cancelled')).status, 200);
    const restored = (await (await status(created.id, 'restored')).json()).lesson;
    assert.equal(restored.status, 'changed'); assert.equal(restored.original, null);
    assert.equal((await status(created.id, 'cancelled')).status, 200);
  });
  await t.test('Неверные ID, подмена группы/статуса и лишние параметры не изменяют занятие', async () => {
    const original = snapshot(db);
    for (const badId of ['0', '01', '-1', 'abc', '999999']) {
      assert.equal((await edit(badId)).status, 404); assert.equal((await status(badId, 'cancelled')).status, 404);
    }
    for (const body of [{ ...fields, group: 'ЭК-22' }, { ...fields, status: 'scheduled' }, { ...fields, date: '2026-02-30' }]) {
      assert.equal((await edit(id, body)).status, 400);
    }
    for (const body of [null, [], {}, { status: 'scheduled' }, { status: 'restored', group: 'ЭК-22' }]) {
      assert.equal((await request(`${endpoint}/${id}/status`, 'staff', { method: 'PATCH', body })).status, 400);
    }
    assert.equal((await request(`${endpoint}/${id}?group=ЭК-22`, 'staff', { method: 'PUT', body: fields })).status, 400);
    assert.deepEqual(snapshot(db), original);
  });
  await t.test('Сбой уведомления откатывает создание, редактирование, отмену и восстановление', async () => {
    for (const operation of ['create', 'edit', 'cancel', 'restore']) {
      if (operation === 'restore') assert.equal((await status(id, 'cancelled')).status, 200);
      const original = snapshot(db);
      db.exec("CREATE TRIGGER test_schedule_failure BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'schedule-test-failure'); END");
      try {
        const response = await (operation === 'create' ? create() : operation === 'edit' ? edit(id, { ...fields, room: 'Демо-сбой' })
          : status(id, operation === 'cancel' ? 'cancelled' : 'restored'));
        assert.equal(response.status, 500);
      } finally { db.exec('DROP TRIGGER test_schedule_failure'); }
      assert.deepEqual(snapshot(db), original);
    }
    assert.equal((await status(id, 'restored')).status, 200);
  });
  await t.test('Настоящий перезапуск сохраняет занятия, события, прочтение и сессии; прежние данные целы', async () => {
    const schedule = await studentSchedule(); const notices = await notifications(); const peerNotices = await notifications('peer');
    const other = await notifications('student2'); const staff = await (await request(staffRange)).json();
    await server.stop(); server = await startServer();
    assert.deepEqual(await studentSchedule(), schedule); assert.deepEqual(await notifications(), notices);
    assert.deepEqual(await notifications('peer'), peerNotices); assert.deepEqual(await notifications('student2'), other);
    assert.deepEqual(await (await request(staffRange)).json(), staff);
    for (const route of ['/student/grades', '/student/documents/requests', '/auth/me']) {
      assert.equal((await request(route, 'student1')).status, 200);
    }
    const current = snapshot(db);
    for (const table of Object.keys(before).filter((name) => !['sessions', 'notifications', 'notification_reads', 'schedule_lessons'].includes(name))) {
      assert.deepEqual(current[table], before[table]);
    }
    assert.deepEqual(current.schedule_lessons.filter((item) => before.schedule_lessons.some((old) => old.id === item.id)), before.schedule_lessons);
    assert.deepEqual(current.notifications.filter((item) => before.notifications.some((old) => old.id === item.id)), before.notifications);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  await t.test('Истечение сессии сотрудника запрещает чтение и изменения', async () => {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, accounts.find((account) => account.login === 'staff').id);
    assert.equal((await request(staffRange)).status, 401); assert.equal((await create()).status, 401);
    assert.equal((await edit(id)).status, 401); assert.equal((await status(id, 'cancelled')).status, 401);
  });
});
