export const SCHEDULE_TIME_ZONE = 'Europe/Moscow';

export function moscowNow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: SCHEDULE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function isScheduleDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && value >= '1900-01-01' && value <= '2100-12-31'
    && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function serializeLesson(row) {
  return {
    id: row.id, group: row.group_name, subject: row.subject, date: row.lesson_date,
    startTime: row.start_time, endTime: row.end_time, teacher: row.teacher, room: row.room,
    type: row.lesson_type, status: row.status, changeNote: row.change_note, isDemo: Boolean(row.is_demo),
    original: row.original_date ? { date: row.original_date, startTime: row.original_start_time,
      endTime: row.original_end_time, room: row.original_room } : null,
  };
}

export function getSchedule(db, group, { from, to, upcoming = false, now = moscowNow() }) {
  const hasSchedule = Boolean(group && db.prepare('SELECT 1 FROM schedule_lessons WHERE group_name = ? LIMIT 1').get(group));
  const rows = !group ? [] : upcoming
    ? db.prepare(`SELECT * FROM schedule_lessons WHERE group_name = ? AND status <> 'cancelled'
        AND (lesson_date > ? OR (lesson_date = ? AND end_time > ?))
        ORDER BY lesson_date, start_time, id LIMIT 3`).all(group, now.date, now.date, now.time)
    : db.prepare(`SELECT * FROM schedule_lessons WHERE group_name = ?
        AND (lesson_date BETWEEN ? AND ? OR (status = 'moved' AND original_date BETWEEN ? AND ?))
        ORDER BY lesson_date, start_time, id`).all(group, from, to, from, to);
  return { group: group || null, hasSchedule, timeZone: SCHEDULE_TIME_ZONE, lessons: rows.map(serializeLesson) };
}

export function getLesson(db, group, id) {
  const row = db.prepare('SELECT * FROM schedule_lessons WHERE id = ? AND group_name = ?').get(id, group || '');
  return row ? serializeLesson(row) : null;
}
