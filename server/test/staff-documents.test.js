import { LEGACY_ATTESTATION_COLUMNS } from './helpers/legacy-grades.js';
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
import { createLegacyDemoUsers, LEGACY_USER_COLUMNS } from './helpers/legacy-demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';
import { requestStatusLabel } from '../../client/src/documentRequests.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'staff-documents-tests');
mkdirSync(cache, { recursive: true });

test('Сотрудник: миграция с заявками, обработка, безопасность и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql', '003-grades.sql', '004-documents.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  const accounts = await createLegacyDemoUsers(db);
  const ids = Object.fromEntries(accounts.map((account) => [account.login, account.id]));
  createDemoSchedule(db);
  createDemoGrades(db);
  const marker = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(marker, ids.student1, JSON.stringify({ marker }), Date.now() + 3600000);
  for (const [login, code] of [['student1', 'study_certificate'], ['student2', 'study_period_certificate']]) {
    db.prepare(`INSERT INTO document_requests (student_id, document_type_code, comment, created_at)
      VALUES (?, ?, ?, ?)`).run(ids[login], code, `Демо: заявка ${login} до миграции`, '2026-11-20T10:00:00.000Z');
  }
  const oldTables = ['roles', 'users', 'sessions', 'schedule_lessons', 'schedule_imports',
    'disciplines', 'student_disciplines', 'current_results', 'attestations', 'grades_imports', 'document_types'];
  const snapshot = (tables = oldTables) => Object.fromEntries(tables
    .map((table) => [table, db.prepare(`SELECT ${table === 'users' ? LEGACY_USER_COLUMNS : table === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM ${table} ORDER BY 1`).all()]));
  const storedRequests = () => db.prepare('SELECT * FROM document_requests ORDER BY id').all();
  const legacy = snapshot();
  const legacyRequests = storedRequests();
  db.close();
  db = openDatabase(databasePath);
  t.after(() => db.close());

  await t.test('Миграция сохраняет старые заявки, ID, даты, пользователей, сессии и учебные данные', () => {
    assert.deepEqual(snapshot(), legacy);
    assert.deepEqual(storedRequests().map(({ rejection_reason, ...row }) => {
      assert.equal(rejection_reason, null);
      return row;
    }), legacyRequests.map((row) => ({ ...row })));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, 9);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const before = snapshot([...oldTables, 'document_requests', 'schema_migrations']);
    const second = openDatabase(databasePath);
    second.close();
    assert.deepEqual(snapshot([...oldTables, 'document_requests', 'schema_migrations']), before);
  });

  const secret = randomBytes(48).toString('base64url');
  async function startServer() {
    const child = spawn(process.execPath, ['src/index.js'], {
      cwd: path.join(root, 'server'), windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0',
        NODE_ENV: 'test', TRUST_PROXY: '0' },
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
  const request = (route, cookie, { body, raw, method = 'GET', headers = {} } = {}) => fetch(`${server.url}/api${route}`, {
    method, headers: { Cookie: cookie || '', 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const cookies = {};
  async function login(account) {
    const response = await request('/auth/login', null, { method: 'POST', body: { login: account.login, password: account.password } });
    assert.equal(response.status, 200);
    cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const account of accounts) await login(account);
  const endpoint = '/staff/documents/requests';
  const studentEndpoint = '/student/documents/requests';
  const change = (id, status, rejectionReason) => request(`${endpoint}/${id}/status`, cookies.staff,
    { method: 'PATCH', body: { status, ...(rejectionReason === undefined ? {} : { rejectionReason }) } });
  async function create(login = 'student1') {
    const response = await request(studentEndpoint, cookies[login], {
      method: 'POST', body: { documentTypeCode: 'study_certificate' },
    });
    assert.equal(response.status, 201);
    return (await response.json()).request;
  }
  const routes = [{ route: endpoint }, { route: `${endpoint}/1` },
    { route: `${endpoint}/1/status`, method: 'PATCH', body: { status: 'in_progress' } }];

  await t.test('Все операции закрыты анониму, поддельной cookie и обоим студентам, включая свои заявки', async () => {
    const before = storedRequests();
    for (const { route, ...options } of routes) {
      for (const cookie of [undefined, 'tochka.sid=forged']) {
        const response = await request(route, cookie, options);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      for (const student of ['student1', 'student2']) {
        assert.equal((await request(route, cookies[student], { ...options,
          headers: { 'X-User-Role': 'staff', 'X-User-Id': String(ids.staff) } })).status, 403);
      }
    }
    for (const method of ['PATCH', 'PUT']) {
      for (const suffix of ['/1', '/1/status']) {
        assert.equal((await request(`${studentEndpoint}${suffix}`, cookies.student1,
          { method, body: { status: 'ready' } })).status, 404);
      }
    }
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Сотрудник видит все старые заявки, данные студентов, тип, комментарий и дату без хешей и сессий', async () => {
    const response = await request(endpoint, cookies.staff);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { requests } = await response.json();
    assert.deepEqual(requests.map((item) => item.id), [2, 1]);
    for (const item of requests) {
      const old = legacyRequests.find((row) => row.id === item.id);
      const user = legacy.users.find((row) => row.id === old.student_id);
      assert.deepEqual(item.student, { id: user.id, fullName: user.full_name, email: user.email,
        studentGroup: user.student_group, department: user.department });
      assert.equal(item.studentId, old.student_id);
      assert.equal(item.documentType.code, old.document_type_code);
      assert.ok(item.documentType.name);
      assert.equal(item.comment, old.comment);
      assert.equal(item.createdAt, old.created_at);
      assert.equal(item.status, 'submitted');
      assert.equal(item.rejectionReason, null);
      const detail = await request(`${endpoint}/${item.id}`, cookies.staff);
      assert.equal(detail.status, 200);
      assert.equal(detail.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await detail.json(), { request: item });
      assert.deepEqual(Object.keys(item).sort(), ['comment', 'createdAt', 'documentType', 'id',
        'rejectionReason', 'status', 'student', 'studentId']);
    }
  });

  await t.test('Подана → В работе → Готова: сохраняются поля заявки, студент получает актуальный статус', async () => {
    for (const [status, label] of [['in_progress', 'В работе'], ['ready', 'Готова']]) {
      const response = await change(1, status);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const { request: item } = await response.json();
      assert.equal(item.status, status);
      assert.equal(item.rejectionReason, null);
      assert.equal(requestStatusLabel(item.status), label);
      assert.equal(db.prepare('SELECT status FROM document_requests WHERE id = 1').get().status, status);
      const student = (await (await request(`${studentEndpoint}/1`, cookies.student1)).json()).request;
      const { student: studentData, ...publicItem } = item;
      assert.deepEqual(student, publicItem);
      const list = (await (await request(studentEndpoint, cookies.student1)).json()).requests;
      assert.deepEqual(list.find((row) => row.id === 1), student);
      assert.equal((await request(`${studentEndpoint}/1`, cookies.student2)).status, 404);
      assert.equal(student.comment, legacyRequests[0].comment);
      assert.equal(student.createdAt, legacyRequests[0].created_at);
    }
  });

  await t.test('Отклонение из Подана и В работе сохраняет обрезанную причину, включая 1000 символов', async () => {
    for (const inProgress of [false, true]) {
      const item = inProgress ? await create('student2') : { id: 2 };
      if (inProgress) assert.equal((await change(item.id, 'in_progress')).status, 200);
      const reason = inProgress ? 'я'.repeat(1000) : '  Демо: выбран неподходящий вид справки. \n';
      const response = await change(item.id, 'rejected', reason);
      assert.equal(response.status, 200);
      const updated = (await response.json()).request;
      assert.equal(updated.status, 'rejected');
      assert.equal(updated.rejectionReason, reason.trim());
      assert.equal(requestStatusLabel(updated.status), 'Отклонена');
      const student = (await (await request(`${studentEndpoint}/${item.id}`, cookies.student2)).json()).request;
      assert.equal(student.status, 'rejected');
      assert.equal(student.rejectionReason, reason.trim());
      assert.equal(db.prepare('SELECT rejection_reason FROM document_requests WHERE id = ?').get(item.id).rejection_reason, reason.trim());
    }
  });

  await t.test('Все запрещённые переходы, пропуск этапа и повтор статуса дают 409 без изменений', async () => {
    const allowed = { submitted: ['in_progress', 'rejected'], in_progress: ['ready', 'rejected'], ready: [], rejected: [] };
    for (const from of Object.keys(allowed)) {
      for (const to of Object.keys(allowed)) {
        const item = await create();
        if (['in_progress', 'ready'].includes(from)) assert.equal((await change(item.id, 'in_progress')).status, 200);
        if (from === 'ready') assert.equal((await change(item.id, 'ready')).status, 200);
        if (from === 'rejected') assert.equal((await change(item.id, 'rejected', 'Демо: причина')).status, 200);
        const before = storedRequests();
        const response = await change(item.id, to, to === 'rejected' ? 'Демо: причина' : undefined);
        assert.equal(response.status, allowed[from].includes(to) ? 200 : 409, `${from} → ${to}`);
        if (!allowed[from].includes(to)) assert.deepEqual(storedRequests(), before);
      }
    }
  });

  await t.test('Валидация статуса, причины, типов, JSON и запрет подмены полей; ошибки не изменяют заявку', async () => {
    const item = await create();
    const before = storedRequests();
    const invalidBodies = [undefined, null, [], 'text', 1, true, {},
      ...[null, 1, {}, [], '', 'unknown', 'IN_PROGRESS', 'constructor', "' OR 1=1 --"]
        .map((status) => ({ status })),
      { status: 'rejected' },
      ...[null, 1, true, [], {}, '', ' \n\t ', 'x'.repeat(1001), 'до\u0000после']
        .map((rejectionReason) => ({ status: 'rejected', rejectionReason })),
      ...['submitted', 'in_progress', 'ready'].flatMap((status) => [null, '', 'Демо']
        .map((rejectionReason) => ({ status, rejectionReason }))),
      ...['id', 'studentId', 'student_id', 'role', 'comment', 'createdAt', 'documentTypeCode', 'student', 'extra']
        .map((key) => ({ status: 'in_progress', [key]: ids.student2 })),
    ];
    for (const body of invalidBodies) {
      const response = await request(`${endpoint}/${item.id}/status`, cookies.staff, { method: 'PATCH', body });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
    }
    for (const options of [{ raw: '{' }, { body: { status: 'in_progress' }, headers: { 'Content-Type': 'text/plain' } }]) {
      assert.equal((await request(`${endpoint}/${item.id}/status`, cookies.staff, { method: 'PATCH', ...options })).status, 400);
    }
    assert.equal((await change(item.id, 'rejected', 'x'.repeat(9000))).status, 413);
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Ошибочные ID дают 404, неизвестные параметры URL — 400; записи неизменны', async () => {
    const before = storedRequests();
    for (const id of ['999999', '0', '-1', '1.5', '01', 'abc', '9007199254740993', '1%20OR%201=1']) {
      for (const options of [{ route: `${endpoint}/${id}` },
        { route: `${endpoint}/${id}/status`, method: 'PATCH', body: { status: 'in_progress' } }]) {
        const { route, ...rest } = options;
        const response = await request(route, cookies.staff, rest);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: 'Заявка не найдена.' });
      }
    }
    for (const query of ['studentId=2', 'status=ready', 'extra=1', 'id[]=1', 'id=1&id=2']) {
      for (const { route, ...options } of routes) {
        assert.equal((await request(`${route}?${query}`, cookies.staff, options)).status, 400);
      }
    }
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Смена статуса требует защитный заголовок и отклоняет запросы чужого сайта', async () => {
    const item = await create();
    const before = storedRequests();
    for (const headers of [{ 'X-Tochka-Request': '' }, { Origin: 'https://foreign.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request(`${endpoint}/${item.id}/status`, cookies.staff,
        { method: 'PATCH', body: { status: 'in_progress' }, headers })).status, 403);
    }
    assert.deepEqual(storedRequests(), before);
    assert.equal((await request(`${endpoint}/${item.id}/status`, cookies.staff, { method: 'PATCH',
      body: { status: 'in_progress' }, headers: { Origin: 'http://127.0.0.1:5173' } })).status, 200);
  });

  await t.test('Одновременные повторные и конкурирующие переходы: один успех, один конфликт', async () => {
    const item = await create();
    let responses = await Promise.all([change(item.id, 'in_progress'), change(item.id, 'in_progress')]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    responses = await Promise.all([change(item.id, 'ready'), change(item.id, 'rejected', 'Демо: отказ')]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = (await responses.find((response) => response.status === 200).json()).request;
    assert.deepEqual((await (await request(`${endpoint}/${item.id}`, cookies.staff)).json()).request, winner);
  });

  await t.test('Ошибка SQLite даёт безопасный 500 и откатывает запись; следующая обработка работает', async () => {
    const item = await create();
    db.exec(`CREATE TRIGGER test_staff_failure BEFORE UPDATE ON document_requests
      WHEN NEW.id = ${item.id} AND NEW.status = 'in_progress'
      BEGIN SELECT RAISE(ABORT, 'test-only database failure'); END`);
    const before = storedRequests();
    const response = await change(item.id, 'in_progress');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Ошибка сервера. Попробуйте ещё раз.' });
    assert.deepEqual(storedRequests(), before);
    assert.equal((await change(item.id, 'rejected', 'Демо: отказ')).status, 200);
  });

  await t.test('SQLite запрещает неизвестный статус, переход назад и отказ без причины', async () => {
    const item = await create();
    for (const [status, reason] of [['unknown', null], ['ready', null], ['rejected', null], ['rejected', ''],
      ['rejected', ' '.repeat(2)], ['rejected', 'x'.repeat(1001)], ['in_progress', 'Демо']]) {
      assert.throws(() => db.prepare('UPDATE document_requests SET status = ?, rejection_reason = ? WHERE id = ?')
        .run(status, reason, item.id));
    }
    assert.throws(() => db.prepare("UPDATE document_requests SET status = 'submitted' WHERE id = 1").run());
    assert.equal(db.prepare('SELECT status FROM document_requests WHERE id = ?').get(item.id).status, 'submitted');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await t.test('После настоящего перезапуска статусы и причины сохраняются, прежние модули доступны', async () => {
    const before = snapshot([...oldTables, 'document_requests', 'schema_migrations']);
    const staffList = await (await request(endpoint, cookies.staff)).json();
    await server.stop();
    db.close();
    db = openDatabase(databasePath);
    server = await startServer();
    assert.deepEqual(snapshot([...oldTables, 'document_requests', 'schema_migrations']), before);
    assert.deepEqual(await (await request(endpoint, cookies.staff)).json(), staffList);
    assert.equal((await (await request(`${studentEndpoint}/1`, cookies.student1)).json()).request.status, 'ready');
    const rejected = (await (await request(`${studentEndpoint}/2`, cookies.student2)).json()).request;
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.rejectionReason, 'Демо: выбран неподходящий вид справки.');
    for (const login of ['student1', 'student2']) {
      const list = (await (await request(studentEndpoint, cookies[login])).json()).requests;
      assert.ok(list.every((item) => item.studentId === ids[login] && !Object.hasOwn(item, 'student')));
      assert.equal((await request('/auth/me', cookies[login])).status, 200);
      assert.equal((await request('/student/schedule?from=2026-11-20&to=2026-11-28', cookies[login])).status, 200);
      assert.equal((await request('/student/grades', cookies[login])).status, 200);
    }
    assert.deepEqual(snapshot(oldTables.filter((table) => table !== 'sessions')),
      Object.fromEntries(Object.entries(legacy).filter(([table]) => table !== 'sessions')));
  });

  await t.test('Роль берётся из базы, истёкшая сессия и выход закрывают все операции сотрудника', async () => {
    const before = storedRequests();
    const role = db.prepare('SELECT role_id FROM users WHERE id = ?').get(ids.staff).role_id;
    db.prepare("UPDATE users SET role_id = (SELECT id FROM roles WHERE name = 'student') WHERE id = ?").run(ids.staff);
    for (const { route, ...options } of routes) assert.equal((await request(route, cookies.staff, options)).status, 403);
    db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(role, ids.staff);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, ids.staff);
    for (const { route, ...options } of routes) assert.equal((await request(route, cookies.staff, options)).status, 401);
    await login(accounts.find((account) => account.login === 'staff'));
    assert.equal((await request('/auth/logout', cookies.staff, { method: 'POST' })).status, 204);
    for (const { route, ...options } of routes) assert.equal((await request(route, cookies.staff, options)).status, 401);
    assert.deepEqual(storedRequests(), before);
  });
});
