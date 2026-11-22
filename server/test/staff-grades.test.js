import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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
import { getGradeStudents, saveStaffAttestation } from '../src/services/staff-grades.js';
import { LEGACY_ATTESTATION_COLUMNS } from './helpers/legacy-grades.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/staff-grades-tests');
mkdirSync(cache, { recursive: true });
function legacyDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of readdirSync(new URL('../src/db/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql') && name < '009').sort()) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  return db;
}
const snapshot = (db, legacy = false) => Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name <> 'schema_migrations' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT ${legacy && name === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM "${name}" ORDER BY rowid`).all()]));

test('Управление успеваемостью: миграция, аттестация, уведомления, защита и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = legacyDatabase(databasePath);
  const accounts = await createDemoUsers(db);
  createDemoSchedule(db); createDemoGrades(db); createDemoNotifications(db);
  const ids = Object.fromEntries(accounts.map((item) => [item.login, item.id]));
  const student = db.prepare('SELECT * FROM users WHERE id = ?').get(ids.student1);
  // Сосед по группе также не должен получать персональные оценки и уведомления.
  const peer = db.prepare(`INSERT INTO users (login, password_hash, role_id, full_name, email, department, course, student_group)
    VALUES ('peer', ?, ?, 'Вымышленный сосед', 'peer@example.test', ?, 2, ?)`).run(student.password_hash, student.role_id, student.department, student.student_group);
  accounts.push({ login: 'peer', password: accounts.find((item) => item.login === 'student1').password });
  ids.peer = Number(peer.lastInsertRowid);
  db.prepare('INSERT INTO notification_reads (notification_id, student_id) SELECT MIN(id), ? FROM notifications').run(ids.student1);
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(randomBytes(24).toString('hex'), ids.student1, '{}', Date.now() + 3600000);
  const legacy = snapshot(db, true);
  db.close(); db = openDatabase(databasePath);
  t.after(() => db.close());
  await t.test('009 дополняет таблицу без потери всех прежних данных, сессий и прочтения; повтор безопасен', () => {
    assert.deepEqual(snapshot(db, true), legacy);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 9);
    for (const item of db.prepare('SELECT * FROM attestations').all()) {
      assert.equal(item.is_differentiated, 0); assert.equal(item.grade, null); assert.equal(item.revision, 0);
    }
    const before = snapshot(db);
    const second = openDatabase(databasePath); second.close();
    assert.deepEqual(snapshot(db), before);
    const empty = openDatabase(':memory:');
    try { assert.deepEqual(getGradeStudents(empty), []); } finally { empty.close(); }
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
  const endpoint = '/staff/grades/students';
  const studentRoute = `${endpoint}/${ids.student1}`;
  const examId = db.prepare("SELECT sd.id FROM student_disciplines sd JOIN attestations a ON a.student_discipline_id = sd.id WHERE sd.student_id = ? AND a.type = 'exam' LIMIT 1").get(ids.student1).id;
  const creditId = db.prepare("SELECT sd.id FROM student_disciplines sd JOIN attestations a ON a.student_discipline_id = sd.id WHERE sd.student_id = ? AND a.type = 'credit' AND a.status = 'pending' LIMIT 1").get(ids.student1).id;
  const otherId = db.prepare('SELECT id FROM student_disciplines WHERE student_id = ? LIMIT 1').get(ids.student2).id;
  const route = (id = examId, type = 'exam', studentId = ids.student1) => `${endpoint}/${studentId}/disciplines/${id}/${type}`;
  const fields = (result = '4', expectedRevision = 0, differentiated = false, grade = null) => ({ result, differentiated, grade, expectedRevision });
  const save = (id, type, body, login = 'staff', headers) => request(route(id, type), login, { method: 'PUT', body, headers });
  const grades = async (login = 'student1') => {
    const response = await request('/student/grades', login); assert.equal(response.status, 200); return response.json();
  };
  const notices = async (login = 'student1') => {
    const response = await request('/student/notifications', login); assert.equal(response.status, 200); return response.json();
  };
  const row = (id, type) => db.prepare('SELECT * FROM attestations WHERE student_discipline_id = ? AND type = ?').get(id, type);
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  await t.test('Без входа 401; student1/student2 не могут читать staff API или записывать оценки', async () => {
    const before = snapshot(db);
    for (const [login, expected] of [['anonymous', 401], ['student1', 403], ['student2', 403]]) {
      assert.equal((await request(endpoint, login)).status, expected);
      assert.equal((await request(studentRoute, login)).status, expected);
      assert.equal((await save(examId, 'exam', fields(), login)).status, expected);
      assert.equal((await save(creditId, 'credit', fields('Зачтено'), login)).status, expected);
    }
    assert.deepEqual(snapshot(db), before);
  });
  await t.test('Справочник содержит только студентов из SQLite; staff видит текущие и итоговые результаты', async () => {
    const response = await request(endpoint); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { students } = await response.json(); assert.equal(students.length, 3);
    assert.ok(students.some((item) => item.id === ids.student1 && item.department === student.department && item.course === 2 && item.group === student.student_group));
    assert.ok(!JSON.stringify(students).includes('password'));
    assert.deepEqual(await (await request(studentRoute)).json(), await grades());
    assert.deepEqual(await (await request(`${endpoint}/${ids.peer}`)).json(), { disciplines: [] });
    for (const suffix of ['/0', '/-1', '/abc', '/99999', `/${ids.staff}`]) assert.equal((await request(endpoint + suffix)).status, 404);
    assert.equal((await request(endpoint + '?group=ИС-21')).status, 400);
  });
  await t.test('Изменение экзамена сохраняет ID без дубликата, видно только адресату; уведомление персональное', async () => {
    const other = await grades('student2'), otherNotices = await notices('student2'), peerNotices = await notices('peer');
    const n = count(), previous = row(examId, 'exam');
    const response = await save(examId, 'exam', fields('2')); assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const saved = row(examId, 'exam'); assert.equal(saved.id, previous.id); assert.equal(saved.result, '2'); assert.equal(saved.revision, 1);
    const discipline = (await grades()).disciplines.find((item) => item.id === examId);
    assert.equal(discipline.attestations.length, 1); assert.equal(discipline.attestations[0].result, '2');
    const notice = (await notices()).notifications[0];
    assert.equal(count(), n + 1); assert.equal(notice.title, 'Результат аттестации изменён');
    assert.ok(notice.body.includes(discipline.name) && notice.body.includes('Экзамен: 2'));
    assert.equal(db.prepare('SELECT recipient_id, group_name FROM notifications WHERE id = ?').get(notice.id).recipient_id, ids.student1);
    assert.equal(db.prepare('SELECT group_name FROM notifications WHERE id = ?').get(notice.id).group_name, null);
    assert.deepEqual(await grades('student2'), other); assert.deepEqual(await notices('student2'), otherNotices); assert.deepEqual(await notices('peer'), peerNotices);
    assert.equal((await request(`/student/notifications/${notice.id}/read`, 'student2', { method: 'PATCH', body: {} })).status, 404);
    assert.equal((await request(`/student/notifications/${notice.id}/read`, 'student1', { method: 'PATCH', body: {} })).status, 200);
  });
  await t.test('Публикация ожидающего обычного зачёта и изменение на «Не зачтено»', async () => {
    const previous = row(creditId, 'credit'), n = count();
    assert.equal((await save(creditId, 'credit', fields('Зачтено'))).status, 200);
    assert.equal(row(creditId, 'credit').id, previous.id); assert.equal(row(creditId, 'credit').status, 'published');
    assert.equal((await notices()).notifications[0].title, 'Выставлен результат аттестации');
    assert.equal((await save(creditId, 'credit', fields('Не зачтено', 1))).status, 200);
    assert.equal(row(creditId, 'credit').result, 'Не зачтено'); assert.equal(row(creditId, 'credit').grade, null);
    assert.equal(count(), n + 2); assert.ok((await notices()).notifications[0].body.includes('Зачёт: Не зачтено'));
  });
  await t.test('Дифференцированный зачёт с обеими статусами; изменение только оценки и возврат к обычному', async () => {
    const originalId = row(creditId, 'credit').id, n = count();
    for (const [result, revision, grade] of [['Зачтено', 2, 4], ['Зачтено', 3, 5], ['Не зачтено', 4, 2]]) {
      assert.equal((await save(creditId, 'credit', fields(result, revision, true, grade))).status, 200);
      const item = (await grades()).disciplines.find((item) => item.id === creditId).attestations[0];
      assert.equal(item.id, originalId); assert.equal(item.differentiated, true); assert.equal(item.grade, grade); assert.equal(item.result, result);
      assert.ok((await notices()).notifications[0].body.includes(`Дифференцированный зачёт: ${result}, оценка ${grade}`));
    }
    assert.equal((await save(creditId, 'credit', fields('Зачтено', 5))).status, 200);
    assert.equal(row(creditId, 'credit').grade, null); assert.equal(row(creditId, 'credit').is_differentiated, 0);
    assert.equal(count(), n + 4);
  });
  await t.test('Добавление отсутствующего экзамена и зачёта; повтор создания и устаревшее редактирование — 409', async () => {
    const n = count();
    assert.equal((await save(creditId, 'exam', fields('3', null))).status, 200);
    assert.equal(row(creditId, 'exam').result, '3');
    assert.equal((await save(examId, 'credit', fields('Зачтено', null, true, 5))).status, 200);
    assert.equal(count(), n + 2);
    const before = snapshot(db);
    assert.equal((await save(creditId, 'exam', fields('4', null))).status, 409);
    assert.equal((await save(examId, 'exam', fields('5', 0))).status, 409);
    assert.deepEqual(snapshot(db), before);
  });
  await t.test('Повтор без изменений не создаёт уведомления или новую запись', async () => {
    const before = snapshot(db);
    const response = await save(examId, 'exam', fields('2', 1)); assert.equal(response.status, 200);
    assert.equal((await response.json()).unchanged, true); assert.deepEqual(snapshot(db), before);
  });
  await t.test('Параллельные изменения: сохраняется одно, второе получает конфликт', async () => {
    const n = count();
    const responses = await Promise.all(['4', '5'].map((result) => save(creditId, 'exam', fields(result, 0))));
    assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409]);
    assert.equal(count(), n + 1); assert.equal(row(creditId, 'exam').revision, 1);
  });
  await t.test('Неверные результаты, дифференцирование, версии, дополнительные поля и подмена владельца отклоняются', async () => {
    const before = snapshot(db);
    const valid = fields('4', 1);
    for (const body of [null, [], {}, ...Object.keys(valid).map((key) => ({ ...valid, [key]: undefined })),
      ...[1, '1', '6', null, 'Зачтено'].map((result) => ({ ...valid, result })),
      { ...valid, differentiated: true }, { ...valid, grade: 4 }, { ...valid, differentiated: 'false' },
      { ...valid, expectedRevision: -1 }, { ...valid, expectedRevision: '1' }, { ...valid, expectedRevision: 1.5 },
      { ...valid, studentId: ids.student2 }, { ...valid, status: 'pending' }]) {
      assert.equal((await save(examId, 'exam', body)).status, 400);
    }
    for (const body of [fields('5', 6), fields('Зачтено', 6, false, 5), fields('Зачтено', 6, true), fields('Зачтено', 6, true, 2),
      fields('Не зачтено', 6, true, 4), fields('Зачтено', 6, true, '4'), fields('Зачтено', 6, true, 4.5), fields('Зачтено', 6, true, 6)]) {
      assert.equal((await save(creditId, 'credit', body)).status, 400);
    }
    for (const wrong of [route(otherId), route(examId, 'exam', ids.student2), route(examId, 'exam', ids.staff), route(99999), route('abc')]) {
      assert.equal((await request(wrong, 'staff', { method: 'PUT', body: valid })).status, 404);
    }
    assert.equal((await save(examId, 'unknown', valid)).status, 400);
    assert.equal((await request(route() + '?studentId=2', 'staff', { method: 'PUT', body: valid })).status, 400);
    for (const headers of [{ Origin: 'https://foreign.invalid' }, { 'X-Tochka-Request': '' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await save(examId, 'exam', valid, 'staff', headers)).status, 403);
    }
    for (const login of ['student1', 'student2']) assert.equal((await request('/student/grades?studentId=1', login)).status, 400);
    assert.deepEqual(snapshot(db), before);
  });
  await t.test('Сбой уведомления откатывает изменение и создание аттестации целиком', async () => {
    const before = snapshot(db);
    db.exec("CREATE TRIGGER test_grade_failure BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'grade-test-failure'); END");
    try {
      assert.equal((await save(examId, 'exam', fields('5', 1))).status, 500);
      assert.equal((await request(route(otherId, 'credit', ids.student2), 'staff', { method: 'PUT', body: fields('Зачтено', null) })).status, 500);
    } finally { db.exec('DROP TRIGGER test_grade_failure'); }
    assert.deepEqual(snapshot(db), before);
  });
  await t.test('SQLite запрещает новые дубликаты и противоречивые оценки', () => {
    assert.throws(() => db.prepare(`INSERT INTO attestations (student_discipline_id, type, result, grading_rules, status)
      VALUES (?, 'exam', '5', 'Шкала', 'published')`).run(examId), /duplicate-attestation/);
    const item = row(examId, 'credit');
    assert.throws(() => db.prepare('UPDATE attestations SET grade = 2 WHERE id = ?').run(item.id));
    assert.throws(() => db.prepare('UPDATE attestations SET grade = NULL WHERE id = ?').run(item.id));
    assert.throws(() => db.prepare('UPDATE attestations SET revision = -1 WHERE id = ?').run(item.id));
    assert.throws(() => db.prepare("UPDATE attestations SET type = 'exam' WHERE id = ?").run(item.id));
  });
  await t.test('Настоящий перезапуск сохраняет результаты, уведомления, прочтение и сессии; остальные данные целы', async () => {
    const results = await grades(), noticesBefore = await notices(), other = await grades('student2'), otherNotices = await notices('student2');
    const staffResults = await (await request(studentRoute)).json();
    await server.stop(); server = await startServer();
    assert.deepEqual(await grades(), results); assert.deepEqual(await notices(), noticesBefore);
    assert.deepEqual(await grades('student2'), other); assert.deepEqual(await notices('student2'), otherNotices);
    assert.deepEqual(await (await request(studentRoute)).json(), staffResults);
    for (const route of ['/student/schedule?from=2026-11-20&to=2026-11-28', '/student/documents/requests', '/auth/me']) {
      assert.equal((await request(route, 'student1')).status, 200);
    }
    const current = snapshot(db, true);
    for (const name of Object.keys(legacy).filter((name) => !['attestations', 'sessions', 'notifications', 'notification_reads'].includes(name))) {
      assert.deepEqual(current[name], legacy[name]);
    }
    assert.deepEqual(current.notifications.filter((item) => legacy.notifications.some((old) => old.id === item.id)), legacy.notifications);
    assert.ok(current.notification_reads.some((item) => legacy.notification_reads.some((old) => item.notification_id === old.notification_id && item.read_at === old.read_at)));
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
  await t.test('Истёкшая сессия запрещает чтение и запись', async () => {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, ids.staff);
    assert.equal((await request(studentRoute)).status, 401); assert.equal((await save(examId, 'exam', fields('5', 1))).status, 401);
  });
});

test('009 сохраняет прежние дубликаты без удаления и блокирует неоднозначное редактирование', async () => {
  const filename = path.join(mkdtempSync(path.join(cache, 'duplicates-')), 'test.sqlite');
  let db = legacyDatabase(filename);
  await createDemoUsers(db); createDemoGrades(db);
  const original = db.prepare('SELECT * FROM attestations ORDER BY id LIMIT 1').get();
  db.prepare(`INSERT INTO attestations (student_discipline_id, type, result, grading_rules, status)
    VALUES (?, ?, ?, ?, ?)`).run(original.student_discipline_id, original.type, original.result, original.grading_rules, original.status);
  const before = snapshot(db, true);
  db.close(); db = openDatabase(filename);
  try {
    assert.deepEqual(snapshot(db, true), before);
    const studentId = db.prepare('SELECT student_id FROM student_disciplines WHERE id = ?').get(original.student_discipline_id).student_id;
    assert.equal(saveStaffAttestation(db, studentId, original.student_discipline_id, original.type,
      { result: '3', differentiated: false, grade: null, expectedRevision: 0 }).outcome, 'conflict');
    assert.deepEqual(snapshot(db, true), before);
  } finally { db.close(); }
});

test('009 при сбое откатывает схему и данные; повтор после устранения сбоя безопасен', async () => {
  const filename = path.join(mkdtempSync(path.join(cache, 'rollback-')), 'test.sqlite');
  let db = legacyDatabase(filename);
  await createDemoUsers(db); createDemoGrades(db);
  db.exec('CREATE TRIGGER attestation_no_duplicate_update BEFORE INSERT ON grades_imports BEGIN SELECT 1; END');
  const before = snapshot(db);
  db.close(); assert.throws(() => openDatabase(filename), /already exists/);
  db = new DatabaseSync(filename);
  assert.deepEqual(snapshot(db), before);
  assert.ok(!db.prepare('PRAGMA table_info(attestations)').all().some((item) => item.name === 'grade'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 8);
  // Удаляется только искусственное препятствие внутри отдельной тестовой базы.
  db.exec('DROP TRIGGER attestation_no_duplicate_update'); db.close(); db = openDatabase(filename);
  try { assert.deepEqual(snapshot(db, true), before); } finally { db.close(); }
});
