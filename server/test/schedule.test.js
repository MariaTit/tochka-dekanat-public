import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { openDatabase } from '../src/db/database.js';
import { createDemoUsers } from '../src/services/demo-users.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';
import { getSchedule, isScheduleDate, moscowNow } from '../src/services/schedule.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = path.join(root, '.cache', 'schedule-tests');
mkdirSync(cache, { recursive: true });

test('Расписание: изоляция групп, API и сохранение данных', async (t) => {
  const databasePath = path.join(mkdtempSync(path.join(cache, 'run-')), 'test.sqlite');
  const db = openDatabase(databasePath);
  t.after(() => db.close());
  const accounts = await createDemoUsers(db);
  const usersBefore = db.prepare('SELECT * FROM users ORDER BY id').all();
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
    return { url, async stop() { if (child.exitCode !== null || child.signalCode !== null) return; const closed = once(child, 'exit'); child.kill(); await closed; } };
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
  const range = '/student/schedule?from=2026-11-20&to=2026-11-28';

  await t.test('Отсутствие опубликованного расписания', async () => {
    const data = await (await request(range, cookies.student1)).json();
    assert.equal(data.group, 'ИС-21');
    assert.equal(data.hasSchedule, false);
    assert.deepEqual(data.lessons, []);
  });

  await t.test('Контролируемое заполнение, повтор без перезаписи и без изменения пользователей и сессий', () => {
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY sid').all();
    assert.equal(createDemoSchedule(db), 32);
    const before = db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all();
    assert.equal(createDemoSchedule(db), 0);
    assert.deepEqual(db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
    assert.deepEqual(db.prepare('SELECT * FROM sessions ORDER BY sid').all(), sessions);
    for (const lesson of before) {
      assert.equal(lesson.is_demo, 1);
      assert.match(lesson.subject, /^Демо:/);
      assert.match(lesson.teacher, /^Демо-преподаватель/);
      assert.match(lesson.room, /^Демо-/);
      assert.ok(lesson.lesson_date >= '2026-11-20' && lesson.lesson_date <= '2026-11-28');
    }
  });

  await t.test('API закрыт для анонимных, поддельных cookie и сотрудника', async () => {
    for (const route of [range, '/student/schedule/upcoming', '/student/schedule/1']) {
      assert.equal((await request(route)).status, 401);
      assert.equal((await request(route, 'tochka.sid=forged')).status, 401);
      assert.equal((await request(route, cookies.staff)).status, 403);
    }
  });

  let groupOne;
  let groupTwo;
  await t.test('Каждый студент получает только свою группу, сведения и подробности', async () => {
    const first = await request(range, cookies.student1);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get('cache-control'), 'no-store');
    groupOne = await first.json();
    groupTwo = await (await request(range, cookies.student2)).json();
    for (const [data, group, cookie] of [[groupOne, 'ИС-21', cookies.student1], [groupTwo, 'ЭК-22', cookies.student2]]) {
      assert.equal(data.group, group);
      assert.equal(data.hasSchedule, true);
      assert.equal(data.timeZone, 'Europe/Moscow');
      assert.equal(data.lessons.length, 16);
      for (const lesson of data.lessons) {
        assert.equal(lesson.group, group);
        for (const field of ['subject', 'date', 'startTime', 'endTime', 'teacher', 'room', 'type']) assert.ok(lesson[field]);
        const detail = await request(`/student/schedule/${lesson.id}`, cookie);
        assert.equal(detail.status, 200);
        assert.deepEqual((await detail.json()).lesson, lesson);
      }
    }
    assert.equal((await request(`/student/schedule/${groupTwo.lessons[0].id}`, cookies.student1)).status, 404);
    assert.equal((await request(`/student/schedule/${groupOne.lessons[0].id}`, cookies.student2)).status, 404);
    assert.equal((await request('/student/schedule/999999', cookies.student1)).status, 404);
    assert.equal((await request('/student/schedule/invalid', cookies.student1)).status, 404);
  });

  await t.test('Подмена группы и некорректные даты отклоняются', async () => {
    for (const query of ['from=2026-11-20&to=2026-11-28&group=ЭК-22', 'from=2026-11-20&to=2026-11-28&userId=2',
      'from=2026-02-30&to=2026-03-01', 'from=2026-11-28&to=2026-11-20', 'from=2026-01-01&to=2026-12-31',
      'from[]=2026-11-20&to=2026-11-28', 'from=2026-11-20&from=2026-11-21&to=2026-11-28', '']) {
      assert.equal((await request(`/student/schedule?${query}`, cookies.student1)).status, 400);
    }
    assert.equal((await request('/student/schedule/upcoming?group=ЭК-22', cookies.student1)).status, 400);
    assert.equal(isScheduleDate('2028-02-29'), true);
    assert.equal(isScheduleDate('2026-02-29'), false);
    assert.equal(isScheduleDate('2026-13-01'), false);
  });

  await t.test('Пустой период отличается от отсутствия расписания; изменения, отмена и перенос на обеих датах', async () => {
    const empty = await (await request('/student/schedule?from=2026-11-22&to=2026-11-22', cookies.student1)).json();
    assert.equal(empty.hasSchedule, true);
    assert.deepEqual(empty.lessons, []);
    for (const status of ['changed', 'moved', 'cancelled']) assert.ok(groupOne.lessons.some((lesson) => lesson.status === status && lesson.changeNote));
    const moved = groupOne.lessons.find((lesson) => lesson.status === 'moved');
    assert.equal(moved.original.date, '2026-11-24');
    assert.equal(moved.date, '2026-11-25');
    for (const day of [moved.date, moved.original.date]) {
      const data = await (await request(`/student/schedule?from=${day}&to=${day}`, cookies.student1)).json();
      assert.ok(data.lessons.some((lesson) => lesson.id === moved.id));
    }
  });

  await t.test('Ближайшие занятия: единая база, сортировка, текущее время, без отмен и прежних слотов переносов', async () => {
    assert.deepEqual(moscowNow(new Date('2026-11-19T22:30:00Z')), { date: '2026-11-20', time: '01:30' });
    const before = getSchedule(db, 'ИС-21', { upcoming: true, now: { date: '2026-11-20', time: '08:00' } });
    assert.equal(before.lessons.length, 3);
    assert.equal(before.lessons[0].startTime, '09:00');
    const ongoing = getSchedule(db, 'ИС-21', { upcoming: true, now: { date: '2026-11-20', time: '09:30' } });
    assert.equal(ongoing.lessons[0].startTime, '09:00');
    const after = getSchedule(db, 'ИС-21', { upcoming: true, now: { date: '2026-11-27', time: '10:40' } });
    assert.ok(after.lessons.every((lesson) => lesson.status !== 'cancelled'));
    assert.equal(after.lessons[0].date, '2026-11-28');
    assert.deepEqual(getSchedule(db, 'ИС-21', { upcoming: true, now: { date: '2026-11-29', time: '00:00' } }).lessons, []);
    for (const [login, group] of [['student1', 'ИС-21'], ['student2', 'ЭК-22']]) {
      const response = await request('/student/schedule/upcoming', cookies[login]);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.group, group);
      assert.ok(data.lessons.length <= 3);
      assert.ok(data.lessons.every((lesson) => lesson.group === group));
    }
  });

  await t.test('Изменённые занятия, данные и сессии сохраняются после перезапуска процесса', async () => {
    const id = groupOne.lessons[0].id;
    db.prepare('UPDATE schedule_lessons SET room = ? WHERE id = ?').run('Демо-проверка сохранения', id);
    const before = db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all();
    await server.stop();
    server = await startServer();
    assert.equal(createDemoSchedule(db), 0);
    assert.deepEqual(db.prepare('SELECT * FROM schedule_lessons ORDER BY id').all(), before);
    assert.deepEqual(db.prepare('SELECT * FROM users ORDER BY id').all(), usersBefore);
    assert.equal((await (await request(`/student/schedule/${id}`, cookies.student1)).json()).lesson.room, 'Демо-проверка сохранения');
    for (const login of ['student1', 'student2']) assert.equal((await request(range, cookies[login])).status, 200);
    const response = await request('/auth/logout', cookies.student1, { method: 'POST' });
    assert.equal(response.status, 204);
    assert.equal((await request(range, cookies.student1)).status, 401);
    assert.equal((await request('/student/schedule/upcoming', cookies.student1)).status, 401);
    assert.equal((await request(`/student/schedule/${id}`, cookies.student1)).status, 401);
  });
});
