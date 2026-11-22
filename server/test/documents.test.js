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

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'documents-tests');
mkdirSync(cache, { recursive: true });

test('Документы: миграция, подача, валидация, доступ и сохранение заявок', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of ['001-auth.sql', '002-schedule.sql', '003-grades.sql']) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  const accounts = await createLegacyDemoUsers(db);
  const studentIds = Object.fromEntries(accounts.map((account) => [account.login, account.id]));
  createDemoSchedule(db);
  createDemoGrades(db);
  const marker = randomBytes(16).toString('hex');
  db.prepare('INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)')
    .run(marker, studentIds.student1, JSON.stringify({ marker }), Date.now() + 3600000);
  const oldTables = ['roles', 'users', 'sessions', 'schedule_lessons', 'schedule_imports',
    'disciplines', 'student_disciplines', 'current_results', 'attestations', 'grades_imports'];
  const snapshot = (tables = oldTables) => Object.fromEntries(tables
    .map((table) => [table, db.prepare(`SELECT ${table === 'users' ? LEGACY_USER_COLUMNS : table === 'attestations' ? LEGACY_ATTESTATION_COLUMNS : '*'} FROM ${table} ORDER BY 1`).all()]));
  const legacy = snapshot();
  db.close();
  db = openDatabase(databasePath);
  t.after(() => db.close());

  await t.test('Миграция старой базы сохраняет все таблицы, пароли и сессии; повторное открытие безопасно', () => {
    assert.deepEqual(snapshot(), legacy);
    assert.deepEqual(db.prepare('SELECT name FROM schema_migrations ORDER BY name').all().map((row) => row.name),
      ['001-auth.sql', '002-schedule.sql', '003-grades.sql', '004-documents.sql', '005-document-processing.sql', '006-notifications.sql', '007-student-profile.sql', '008-staff-schedule.sql', '009-staff-grades.sql']);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM document_requests').get().count, 0);
    const before = snapshot(['document_types', 'schema_migrations']);
    const second = openDatabase(databasePath);
    second.close();
    assert.deepEqual(snapshot(['document_types', 'schema_migrations']), before);
    assert.deepEqual(snapshot(), legacy);
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
  for (const account of accounts) {
    const response = await request('/auth/login', null, { method: 'POST', body: { login: account.login, password: account.password } });
    assert.equal(response.status, 200);
    cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  const base = '/student/documents';
  const endpoint = `${base}/requests`;
  const documentTypeCode = 'study_certificate';
  const validBody = { documentTypeCode };
  const routes = [{ route: `${base}/types` }, { route: endpoint }, { route: `${endpoint}/1` },
    { route: endpoint, method: 'POST', body: validBody }];
  const storedRequests = () => db.prepare('SELECT * FROM document_requests ORDER BY id').all();
  const created = { student1: [], student2: [] };

  await t.test('Все четыре операции закрыты без сессии, с поддельной cookie и для сотрудника', async () => {
    for (const { route, ...options } of routes) {
      for (const cookie of [undefined, 'tochka.sid=forged']) {
        const response = await request(route, cookie, options);
        assert.equal(response.status, 401);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
      assert.equal((await request(route, cookies.staff, { ...options, headers: { 'X-User-Role': 'student' } })).status, 403);
    }
    assert.deepEqual(storedRequests(), []);
  });

  await t.test('Оба студента получают справочник типов и пустой список; демозаявки не создаются', async () => {
    for (const login of ['student1', 'student2']) {
      const response = await request(`${base}/types`, cookies[login]);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { documentTypes: [
        { code: documentTypeCode, name: 'Справка об обучении' },
        { code: 'study_period_certificate', name: 'Справка о периоде обучения' },
      ] });
      assert.deepEqual(await (await request(endpoint, cookies[login])).json(), { requests: [] });
    }
  });

  await t.test('Подача обоих типов, необязательный комментарий, граница длины и автоматические поля', async () => {
    for (const login of ['student1', 'student2']) {
      for (const body of [validBody, { documentTypeCode: 'study_period_certificate', comment: '  Демо: для предоставления по месту требования.  ' },
        { documentTypeCode, comment: ' \n\t ' }, { documentTypeCode, comment: 'я'.repeat(1000) }]) {
        const before = Date.now();
        const response = await request(endpoint, cookies[login], { method: 'POST', body });
        assert.equal(response.status, 201);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const data = await response.json();
        assert.deepEqual(Object.keys(data), ['request']);
        const item = data.request;
        assert.deepEqual(Object.keys(item).sort(), ['comment', 'createdAt', 'documentType', 'id', 'rejectionReason', 'status', 'studentId']);
        assert.equal(item.rejectionReason, null);
        assert.ok(Number.isSafeInteger(item.id) && item.id > 0);
        assert.equal(item.studentId, studentIds[login]);
        assert.equal(item.documentType.code, body.documentTypeCode);
        assert.ok(item.documentType.name);
        assert.equal(item.comment, body.comment?.trim() || null);
        assert.equal(item.status, 'submitted');
        assert.match(item.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
        assert.ok(Date.parse(item.createdAt) >= before && Date.parse(item.createdAt) <= Date.now());
        assert.equal(response.headers.get('location'), `/api${endpoint}/${item.id}`);
        assert.deepEqual(await (await request(`${endpoint}/${item.id}`, cookies[login])).json(), data);
        created[login].push(item);
      }
    }
  });

  await t.test('Ошибочные типы, комментарии, тела и подмена служебных полей не создают записей', async () => {
    const before = storedRequests();
    const invalidBodies = [undefined, null, [], 'text', 1, true, {}, { comment: 'Демо' },
      ...[null, 1, {}, [], '', 'unknown', "' OR 1=1 --", 'x'.repeat(65)].map((code) => ({ documentTypeCode: code })),
      ...[null, 1, false, [], {}, 'я'.repeat(1001), 'до\u0000после'].map((comment) => ({ ...validBody, comment })),
      ...['studentId', 'student_id', 'userId', 'status', 'createdAt', 'id', 'role', 'extra']
        .map((key) => ({ ...validBody, [key]: key === 'status' ? 'ready' : studentIds.student2 })),
    ];
    for (const body of invalidBodies) {
      const response = await request(endpoint, cookies.student1, { method: 'POST', body });
      assert.equal(response.status, 400);
      assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal((await request(endpoint, cookies.student1, { method: 'POST', raw: '{' })).status, 400);
    assert.equal((await request(endpoint, cookies.student1, { method: 'POST', body: validBody,
      headers: { 'Content-Type': 'text/plain' } })).status, 400);
    assert.equal((await request(endpoint, cookies.student1, { method: 'POST', body: { ...validBody, comment: 'x'.repeat(9000) } })).status, 413);
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Защита от запросов чужого сайта и отсутствие обязательного заголовка', async () => {
    const before = storedRequests();
    for (const headers of [{ Origin: 'https://foreign.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'X-Tochka-Request': '' }]) {
      assert.equal((await request(endpoint, cookies.student1, { method: 'POST', body: validBody, headers })).status, 403);
    }
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Подмена владельца и статуса в заголовках не меняет автора и начальный статус', async () => {
    const response = await request(endpoint, cookies.student1, { method: 'POST', body: validBody,
      headers: { 'X-Student-Id': String(studentIds.student2), 'X-User-Id': String(studentIds.student2), 'X-User-Role': 'staff', 'X-Status': 'ready' } });
    assert.equal(response.status, 201);
    const item = (await response.json()).request;
    assert.equal(item.studentId, studentIds.student1);
    assert.equal(item.status, 'submitted');
    created.student1.push(item);
  });

  await t.test('Списки содержат только собственные заявки, новые идут первыми; детали совпадают', async () => {
    for (const login of ['student1', 'student2']) {
      const response = await request(endpoint, cookies[login]);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), { requests: [...created[login]].reverse() });
      for (const item of created[login]) {
        const detail = await request(`${endpoint}/${item.id}`, cookies[login]);
        assert.equal(detail.status, 200);
        assert.equal(detail.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await detail.json(), { request: item });
      }
    }
  });

  await t.test('Чужие и отсутствующие заявки дают одинаковый 404; некорректные ID не принимаются', async () => {
    const missing = await request(`${endpoint}/999999`, cookies.student1);
    assert.equal(missing.status, 404);
    const error = await missing.json();
    for (const [login, other] of [['student1', 'student2'], ['student2', 'student1']]) {
      for (const item of created[other]) {
        const response = await request(`${endpoint}/${item.id}`, cookies[login]);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), error);
      }
    }
    for (const id of ['0', '-1', '1.5', '01', 'abc', '9007199254740993', "1%20OR%201=1"]) {
      assert.equal((await request(`${endpoint}/${id}`, cookies.student1)).status, 404);
    }
  });

  await t.test('Параметры выбора владельца и неизвестные параметры отклоняются на всех операциях', async () => {
    const before = storedRequests();
    for (const query of ['studentId=2', 'userId=2', 'group=ЭК-22', 'status=ready', 'studentId[]=2', 'studentId=1&studentId=2']) {
      for (const { route, ...options } of routes) {
        assert.equal((await request(`${route}?${encodeURI(query)}`, cookies.student1, options)).status, 400);
      }
    }
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Изменение, удаление через API студента и создание типов отсутствуют', async () => {
    const before = storedRequests();
    for (const login of ['student1', 'staff']) {
      for (const method of ['PUT', 'PATCH', 'DELETE']) {
        assert.equal((await request(`${endpoint}/${created.student1[0].id}`, cookies[login], { method, body: { status: 'ready' } })).status,
          login === 'staff' ? 403 : 404);
      }
      assert.equal((await request(`${base}/types`, cookies[login], { method: 'POST', body: validBody })).status,
        login === 'staff' ? 403 : 404);
    }
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('SQLite защищает ссылки, начальный статус и длину комментария', () => {
    const insert = db.prepare('INSERT INTO document_requests (student_id, document_type_code, comment, status) VALUES (?, ?, ?, ?)');
    for (const args of [[999999, documentTypeCode, null, 'submitted'], [studentIds.student1, 'unknown', null, 'submitted'],
      [studentIds.student1, documentTypeCode, null, 'ready'], [studentIds.student1, documentTypeCode, 'x'.repeat(1001), 'submitted']]) {
      assert.throws(() => insert.run(...args));
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });

  await t.test('Ошибка записи возвращает 500 без ложного успеха и подробностей SQLite', async () => {
    db.exec(`CREATE TRIGGER test_request_failure BEFORE INSERT ON document_requests
      WHEN NEW.comment = 'Демо: ошибка записи'
      BEGIN SELECT RAISE(ABORT, 'test-only database failure'); END`);
    const before = storedRequests();
    const response = await request(endpoint, cookies.student1, { method: 'POST', body: { ...validBody, comment: 'Демо: ошибка записи' } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Ошибка сервера. Попробуйте ещё раз.' });
    assert.deepEqual(storedRequests(), before);
  });

  await t.test('Заявки, каталог, сессии, расписание и оценки сохраняются при настоящем перезапуске', async () => {
    const before = snapshot([...oldTables, 'document_types', 'document_requests', 'schema_migrations']);
    await server.stop();
    db.close();
    db = openDatabase(databasePath);
    server = await startServer();
    assert.deepEqual(snapshot([...oldTables, 'document_types', 'document_requests', 'schema_migrations']), before);
    assert.deepEqual(snapshot(oldTables.filter((table) => table !== 'sessions')),
      Object.fromEntries(Object.entries(legacy).filter(([table]) => table !== 'sessions')));
    for (const login of ['student1', 'student2']) {
      assert.deepEqual(await (await request(endpoint, cookies[login])).json(), { requests: [...created[login]].reverse() });
      assert.deepEqual(await (await request(`${endpoint}/${created[login][0].id}`, cookies[login])).json(), { request: created[login][0] });
      assert.equal((await request('/auth/me', cookies[login])).status, 200);
      assert.equal((await request('/student/schedule?from=2026-11-20&to=2026-11-28', cookies[login])).status, 200);
      assert.equal((await request('/student/grades', cookies[login])).status, 200);
    }
  });

  await t.test('После выхода и истечения сессии все операции закрыты, сохранённые заявки остаются', async () => {
    const before = storedRequests();
    assert.equal((await request('/auth/logout', cookies.student1, { method: 'POST' })).status, 204);
    db.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, studentIds.student2);
    for (const login of ['student1', 'student2']) {
      for (const { route, ...options } of routes) {
        assert.equal((await request(route, cookies[login], options)).status, 401);
      }
    }
    assert.deepEqual(storedRequests(), before);
  });
});
