export function todayDate() {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(date, count) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

export function weekStart(date) {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}

export function monthStart(date) { return `${date.slice(0, 7)}-01`; }
export function nextMonth(date, offset) {
  const value = new Date(`${monthStart(date)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 10);
}
export function monthEnd(date) { return addDays(nextMonth(date, 1), -1); }
export function dateRange(from, to) {
  const result = [];
  for (let day = from; day <= to; day = addDays(day, 1)) result.push(day);
  return result;
}
export function formatDate(date, options = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

// Перенесённое занятие остаётся заметным в прежний день как сообщение о переносе.
export function lessonsOnDate(lessons, date) {
  return lessons.filter((lesson) => lesson.date === date || (lesson.status === 'moved' && lesson.original?.date === date))
    .sort((a, b) => {
      const time = (lesson) => lesson.date === date ? lesson.startTime : lesson.original.startTime;
      return time(a).localeCompare(time(b)) || a.id - b.id;
    });
}
