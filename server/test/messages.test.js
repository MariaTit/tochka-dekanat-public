import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../src/db/database.js';
import { createDemoUsers } from '../src/services/demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { createDemoGrades } from '../src/services/demo-grades.js';
import { createDemoNotifications } from '../src/services/demo-notifications.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache/messages-tests');
mkdirSync(cache, { recursive: true });
const snapshot = (db, tables) => Object.fromEntries((tables ?? db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => row.name))
  .map((name) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
function legacyDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for (const name of readdirSync(new URL('../src/db/migrations/', import.meta.url)).filter((name) => name.endsWith('.sql') && name < '010').sort()) {
    db.exec(readFileSync(new URL(`../src/db/migrations/${name}`, import.meta.url), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
  }
  return db;
}

test('Личная переписка: миграция, роли, отправка, прочтение, уведомления и перезапуск', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  let db = legacyDatabase(databasePath);
  const accounts = await createDemoUsers(db);
  const ids = Object.fromEntries(accounts.map((item) => [item.login, item.id]));
  createDemoSchedule(db); createDemoGrades(db); createDemoNotifications(db);
  db.prepare('INSERT INTO notification_reads (notification_id, student_id) SELECT min(id), ? FROM notifications').run(ids.student1);
  const staff = db.prepare('SELECT * FROM users WHERE id = ?').get(ids.staff);
  ids.staff2 = Number(db.prepare(`INSERT INTO users (login, password_hash, role_id, full_name, email, department)
    VALUES ('staff2', ?, ?, 'Вымышленный сотрудник', 'staff2@example.test', 'Учебный офис')`).run(staff.password_hash, staff.role_id).lastInsertRowid);
  accounts.push({ login: 'staff2', password: accounts.find((item) => item.login === 'staff').password });
  const legacy = snapshot(db);
  db.close(); db = openDatabase(databasePath);
  t.after(() => db.close());
  await t.test('010 сохраняет каждое прежнее значение, повтор не меняет данные; новые таблицы пусты', () => {
    assert.deepEqual(snapshot(db, Object.keys(legacy).filter((name) => name !== 'schema_migrations')),
      Object.fromEntries(Object.entries(legacy).filter(([name]) => name !== 'schema_migrations')));
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE name < ? ORDER BY rowid').all('010'), legacy.schema_migrations);
    assert.equal(db.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 10);
    assert.equal(db.prepare('SELECT count(*) AS n FROM messages').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM conversations').get().n, 0);
    const before = snapshot(db); const second = openDatabase(databasePath); second.close(); assert.deepEqual(snapshot(db), before);
  });
  const secret = randomBytes(48).toString('base64url');
  async function startServer() {
    const child = spawn(process.execPath, ['src/index.js'], { cwd: path.join(root, 'server'), windowsHide: true,
      env: { ...process.env, DATABASE_PATH: databasePath, SESSION_SECRET: secret, PORT: '0', NODE_ENV: 'test',
        AMVERA: '0', TRUST_PROXY: '0', DEMO_INIT_ENABLED: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const url = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Сервер не запустился')); }, 15000);
      const read = (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); } };
      child.stdout.on('data', read); child.stderr.on('data', read);
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Сервер завершился: ${code}`)); });
    });
    return { url, async stop() { if (child.exitCode !== null || child.signalCode !== null) return; const closed = once(child, 'exit'); child.kill(); await closed; } };
  }
  let server = await startServer(); t.after(() => server.stop());
  const cookies = {};
  const endpoint = (login) => `/${login.startsWith('staff') ? 'staff' : 'student'}/messages`;
  const request = (route, login = 'student1', { method = 'GET', body, headers = {} } = {}) => fetch(`${server.url}/api${route}`, {
    method, headers: { Cookie: cookies[login] || '', 'Content-Type': 'application/json', 'X-Tochka-Request': '1', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const account of accounts) {
    const response = await request('/auth/login', null, { method: 'POST', body: { login: account.login, password: account.password } });
    assert.equal(response.status, 200); cookies[account.login] = response.headers.get('set-cookie').split(';')[0];
  }
  const post = (route, body, login = 'student1') => request(route, login, { method: 'POST', body });
  const open = (recipientId, login = 'student1') => post(endpoint(login), { recipientId }, login);
  const send = (id, text, login = 'student1', clientMessageId = randomUUID()) => post(`${endpoint(login)}/${id}`, { text, clientMessageId }, login);
  const read = (id, throughMessageId, login = 'student1') => request(`${endpoint(login)}/${id}/read`, login, { method: 'PATCH', body: { throughMessageId } });
  const list = async (login = 'student1') => (await request(endpoint(login), login)).json();
  const history = async (id, login = 'student1') => (await request(`${endpoint(login)}/${id}`, login)).json();
  const notices = async (login = 'student1') => (await request('/student/notifications', login)).json();
  const count = () => db.prepare('SELECT count(*) AS n FROM notifications').get().n;
  let firstId, secondId, firstMessageId;

  await t.test('401 без сессии, 403 другой роли, справочник только разрешённых адресатов без секретов', async () => {
    for (const role of ['student', 'staff']) for (const suffix of ['', '/recipients', '/1']) {
      assert.equal((await request(`/${role}/messages${suffix}`, 'anonymous')).status, 401);
      assert.equal((await request(`/${role}/messages${suffix}`, role === 'staff' ? 'student1' : 'staff')).status, 403);
    }
    const recipients = await (await request('/staff/messages/recipients', 'staff')).json();
    assert.equal(recipients.recipients.length, 2); assert.equal(recipients.recipients[0].course, 2);
    assert.ok(recipients.recipients.every((item) => item.department && item.group && item.fullName));
    assert.ok(!JSON.stringify(recipients).includes('password'));
    assert.equal((await (await request('/student/messages/recipients')).json()).recipients.length, 2);
    assert.deepEqual((await list()).conversations, []);
  });
  await t.test('Студент открывает переписку и пишет staff; проверены текст, автор, UTC-время и непрочитанное', async () => {
    const response = await open(ids.staff); assert.equal(response.status, 200);
    firstId = (await response.json()).conversation.id;
    const n = count();
    const sent = await send(firstId, '  Здравствуйте!\nНужна консультация.  '); assert.equal(sent.status, 201);
    firstMessageId = (await sent.json()).messageId;
    const data = await history(firstId, 'staff'); const item = data.messages[0];
    assert.equal(item.senderId, ids.student1); assert.equal(item.senderRole, 'student');
    assert.ok(item.senderName); assert.equal(item.text, 'Здравствуйте!\nНужна консультация.');
    assert.ok(/Z$/.test(item.createdAt)); assert.ok(Math.abs(Date.parse(item.createdAt) - Date.now()) < 60000);
    assert.equal(item.readAt, null); assert.equal(count(), n);
    assert.equal((await list('staff')).unreadCount, 1); assert.equal((await list()).unreadCount, 0);
    assert.equal((await request(`/student/messages/${firstId}`)).headers.get('cache-control'), 'no-store');
  });
  await t.test('staff отвечает: личное уведомление со ссылкой; повтор открытия не создаёт уведомлений', async () => {
    const other = await notices('student2'), n = count();
    assert.equal((await send(firstId, 'Добрый день! Приходите в учебный офис.', 'staff')).status, 201);
    const note = (await notices()).notifications.find((item) => item.conversationId === firstId);
    assert.ok(note); assert.equal(note.readAt, null); assert.equal(note.important, true);
    assert.equal(count(), n + 1); assert.deepEqual(await notices('student2'), other);
    for (let index = 0; index < 3; index++) {
      assert.equal((await (await open(ids.staff)).json()).conversation.id, firstId);
      await history(firstId); await history(firstId, 'staff');
    }
    assert.equal(count(), n + 1); assert.equal((await list()).unreadCount, 1);
    assert.equal((await request(`/student/notifications/${note.id}/read`, 'student2', { method: 'PATCH', body: {} })).status, 404);
  });
  await t.test('Прочтение только показанных сообщений: новый ответ остаётся непрочитанным; отметка идемпотентна', async () => {
    const shown = (await history(firstId)).messages.at(-1).id;
    const next = await (await send(firstId, 'Новое сообщение после загрузки истории.', 'staff')).json();
    assert.equal((await read(firstId, shown)).status, 200);
    assert.equal((await list()).unreadCount, 1);
    const previousRead = (await history(firstId)).messages.find((item) => item.id === shown).readAt;
    assert.ok(previousRead);
    await read(firstId, shown);
    assert.equal((await history(firstId)).messages.find((item) => item.id === shown).readAt, previousRead);
    const notes = (await notices()).notifications.filter((item) => item.conversationId === firstId);
    assert.equal(notes.filter((item) => !item.readAt).length, 1);
    assert.equal((await read(firstId, next.messageId)).status, 200); assert.equal((await list()).unreadCount, 0);
    assert.equal((await read(firstId, firstMessageId, 'staff')).status, 200); assert.equal((await list('staff')).unreadCount, 0);
  });
  await t.test('staff начинает переписку со student2, student1 не получает её уведомление', async () => {
    const before = await notices();
    secondId = (await (await open(ids.student2, 'staff')).json()).conversation.id;
    assert.notEqual(firstId, secondId);
    assert.equal((await send(secondId, 'Здравствуйте, студент второго аккаунта!', 'staff')).status, 201);
    assert.equal((await list('student2')).unreadCount, 1);
    assert.deepEqual(await notices(), before);
    assert.equal((await (await open(ids.staff, 'student2')).json()).conversation.id, secondId);
  });
  await t.test('Подстановка ID: student1/student2 и посторонний staff не читают, не пишут и не отмечают чужое', async () => {
    const before = snapshot(db, ['messages', 'conversations', 'notifications', 'notification_reads']);
    for (const [id, login] of [[firstId, 'student2'], [secondId, 'student1'], [firstId, 'staff2'], [secondId, 'staff2']]) {
      assert.equal((await request(`${endpoint(login)}/${id}`, login)).status, 404);
      assert.equal((await send(id, 'Попытка подмены', login)).status, 404);
      assert.equal((await read(id, firstMessageId, login)).status, 404);
    }
    assert.equal((await list('staff2')).conversations.length, 0);
    assert.deepEqual(snapshot(db, Object.keys(before)), before);
    assert.equal((await read(firstId, (await history(secondId, 'staff')).messages[0].id)).status, 404);
  });
  await t.test('Проверка адресатов, ID, дополнительных полей и запрет отправки от другого имени', async () => {
    for (const id of [ids.student1, ids.student2, 99999]) assert.equal((await open(id)).status, 404);
    assert.equal((await open(ids.staff, 'staff')).status, 404);
    for (const body of [{}, { recipientId: '1' }, { recipientId: 0 }, { recipientId: ids.staff, studentId: ids.student2 }]) {
      assert.equal((await post('/student/messages', body)).status, 400);
    }
    for (const suffix of ['/0', '/-1', '/abc', '/99999']) assert.equal((await request('/student/messages' + suffix)).status, 404);
    assert.equal((await request('/student/messages?studentId=2')).status, 400);
    for (const field of ['senderId', 'studentId', 'staffId', 'role', 'createdAt']) {
      assert.equal((await post(`/student/messages/${firstId}`, { text: 'Подмена', clientMessageId: randomUUID(), [field]: ids.staff })).status, 400);
    }
    assert.equal((await request(`/student/messages/${firstId}/read`, 'student1', { method: 'PATCH', body: { throughMessageId: firstMessageId, senderId: ids.staff } })).status, 400);
  });
  await t.test('Пустой ввод, неверные типы, длина, управляющие символы; HTML хранится обычным текстом', async () => {
    for (const text of ['', ' \n\t ', null, 5, [], {}, 'x'.repeat(4001), 'текст\u0000', 'текст\u0001']) {
      assert.equal((await send(firstId, text)).status, 400);
    }
    assert.equal((await post(`/student/messages/${firstId}`, { text: 'Текст', clientMessageId: 'wrong' })).status, 400);
    assert.equal((await send(firstId, 'я'.repeat(4000))).status, 201);
    assert.equal((await send(firstId, '界'.repeat(4000))).status, 201);
    const html = '<img src=x onerror="window.hacked=1"><script>alert(1)</script>';
    assert.equal((await send(firstId, html)).status, 201);
    assert.equal((await history(firstId)).messages.at(-1).text, html);
  });
  await t.test('Защита изменения: Origin и обязательный заголовок', async () => {
    for (const headers of [{ 'X-Tochka-Request': '' }, { Origin: 'https://other.example.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request(`/student/messages/${firstId}`, 'student1', { method: 'POST', body: { text: 'Test', clientMessageId: randomUUID() }, headers })).status, 403);
    }
  });
  await t.test('Повтор отправки и параллельные запросы не создают дубликаты сообщений или уведомлений', async () => {
    const key = randomUUID(), n = count();
    const responses = await Promise.all([send(firstId, 'Один ответ', 'staff', key), send(firstId, 'Один ответ', 'staff', key)]);
    assert.ok(responses.every((response) => response.status === 201));
    assert.deepEqual(await responses[0].json(), await responses[1].json()); assert.equal(count(), n + 1);
    assert.equal((await send(firstId, 'Другой текст', 'staff', key)).status, 409);
    assert.equal((await send(secondId, 'Один ответ', 'staff', key)).status, 409);
    const opens = await Promise.all([open(ids.staff2), open(ids.staff2)]);
    assert.equal((await opens[0].json()).conversation.id, (await opens[1].json()).conversation.id);
  });
  await t.test('Сбой уведомления откатывает сообщение; сбой прочтения откатывает обе отметки', async () => {
    let before = snapshot(db, ['messages', 'notifications', 'notification_reads']);
    db.exec("CREATE TRIGGER fail_message_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT, 'test'); END");
    try { assert.equal((await send(firstId, 'Не сохранится', 'staff')).status, 500); assert.deepEqual(snapshot(db, Object.keys(before)), before); }
    finally { db.exec('DROP TRIGGER fail_message_notice'); }
    const last = (await history(firstId)).messages.at(-1).id;
    before = snapshot(db, ['messages', 'notification_reads']);
    db.exec("CREATE TRIGGER fail_message_read BEFORE INSERT ON notification_reads BEGIN SELECT RAISE(ABORT, 'test'); END");
    try { assert.equal((await read(firstId, last)).status, 500); assert.deepEqual(snapshot(db, Object.keys(before)), before); }
    finally { db.exec('DROP TRIGGER fail_message_read'); }
  });
  await t.test('Настоящий перезапуск сохраняет историю, сессии и непрочитанное; integrity/FK успешны', async () => {
    const data = await history(firstId), unread = await list('staff'), notes = await notices();
    await server.stop(); server = await startServer();
    assert.deepEqual(await history(firstId), data); assert.deepEqual(await list('staff'), unread); assert.deepEqual(await notices(), notes);
    assert.equal((await send(firstId, 'После перезапуска')).status, 201);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    for (const name of Object.keys(legacy).filter((name) => !['schema_migrations', 'sessions', 'notifications', 'notification_reads'].includes(name))) {
      assert.deepEqual(snapshot(db, [name])[name], legacy[name]);
    }
  });
  await t.test('Выход отзывает доступ к истории и отправке', async () => {
    assert.equal((await request('/auth/logout', 'student1', { method: 'POST', body: {} })).status, 204);
    assert.equal((await request(`/student/messages/${firstId}`)).status, 401);
    assert.equal((await send(firstId, 'После выхода')).status, 401);
    const account = accounts.find((item) => item.login === 'student1');
    const response = await post('/auth/login', { login: account.login, password: account.password });
    assert.equal(response.status, 200); cookies.student1 = response.headers.get('set-cookie').split(';')[0];
    assert.ok((await history(firstId)).messages.some((item) => item.text === 'После перезапуска'));
  });
  await t.test('SQLite запрещает неверные роли и отправителя вне участников; истёкшая сессия закрывает API', async () => {
    assert.throws(() => db.prepare('INSERT INTO conversations (student_id, staff_id) VALUES (?, ?)').run(ids.staff, ids.student1));
    assert.throws(() => db.prepare('INSERT INTO messages (conversation_id, sender_id, client_message_id, text) VALUES (?, ?, ?, ?)')
      .run(firstId, ids.student2, randomUUID(), 'Чужой отправитель'));
    db.prepare('UPDATE sessions SET expires_at = 0 WHERE user_id = ?').run(ids.staff2);
    assert.equal((await request('/staff/messages', 'staff2')).status, 401);
    assert.equal((await open(ids.student1, 'staff2')).status, 401);
  });
});

test('Ошибка миграции 010 полностью откатывает новые таблицы, прежние данные остаются', async () => {
  const filename = path.join(mkdtempSync(path.join(cache, 'rollback-')), 'test.sqlite');
  let db = legacyDatabase(filename);
  db.exec("CREATE TABLE messages (id INTEGER PRIMARY KEY, text TEXT); INSERT INTO messages VALUES (1, 'Прежние данные')");
  const before = snapshot(db); db.close();
  assert.throws(() => openDatabase(filename));
  db = new DatabaseSync(filename);
  try { assert.deepEqual(snapshot(db), before); assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
  finally { db.close(); }
});
