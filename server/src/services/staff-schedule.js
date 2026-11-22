import { getLesson } from './schedule.js';

export function getScheduleGroups(db) {
  // В существующей модели расписание и уведомления связаны с названием группы.
  return db.prepare(`SELECT DISTINCT nullif(trim(u.department), '') AS department, u.course, u.student_group AS "group"
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'student' AND u.student_group IS NOT NULL AND trim(u.student_group) <> ''
    ORDER BY u.department, u.course, u.student_group`).all();
}

export function scheduleGroupExists(db, group) {
  return Boolean(db.prepare(`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'student' AND u.student_group = ? LIMIT 1`).get(group));
}

export function createStaffLesson(db, group, fields) {
  const result = db.prepare(`INSERT INTO schedule_lessons
    (group_name, subject, lesson_date, start_time, end_time, room, teacher, lesson_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(group, fields.subject, fields.date, fields.startTime, fields.endTime, fields.room, fields.teacher, fields.type);
  return getLesson(db, group, Number(result.lastInsertRowid));
}

function withLesson(db, id, change) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const row = db.prepare('SELECT * FROM schedule_lessons WHERE id = ?').get(id);
    const result = row ? change(row) : { outcome: 'not_found' };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateStaffLesson(db, id, fields) {
  return withLesson(db, id, (row) => {
    if (row.status === 'cancelled') return { outcome: 'conflict' };
    const same = row.subject === fields.subject && row.lesson_date === fields.date
      && row.start_time === fields.startTime && row.end_time === fields.endTime
      && row.room === fields.room && row.teacher === fields.teacher && row.lesson_type === fields.type;
    if (!same) {
      const originalDate = row.original_date ?? row.lesson_date;
      const originalStart = row.original_start_time ?? row.start_time;
      const originalEnd = row.original_end_time ?? row.end_time;
      const moved = fields.date !== originalDate || fields.startTime !== originalStart || fields.endTime !== originalEnd;
      db.prepare(`UPDATE schedule_lessons SET subject = ?, lesson_date = ?, start_time = ?, end_time = ?,
        room = ?, teacher = ?, lesson_type = ?, status = ?, change_note = ?,
        original_date = ?, original_start_time = ?, original_end_time = ?, original_room = ? WHERE id = ?`)
        .run(fields.subject, fields.date, fields.startTime, fields.endTime, fields.room, fields.teacher, fields.type,
          moved ? 'moved' : 'changed', moved ? 'Занятие перенесено сотрудником учебного офиса.' : 'Сведения о занятии изменены сотрудником учебного офиса.',
          originalDate, originalStart, originalEnd, row.original_room ?? row.room, id);
    }
    return { outcome: same ? 'unchanged' : 'updated', lesson: getLesson(db, row.group_name, id) };
  });
}

export function changeStaffLessonStatus(db, id, status) {
  return withLesson(db, id, (row) => {
    const cancelling = status === 'cancelled';
    if (cancelling === (row.status === 'cancelled')) return { outcome: 'conflict' };
    const moved = row.original_date && (row.lesson_date !== row.original_date
      || row.start_time !== row.original_start_time || row.end_time !== row.original_end_time);
    db.prepare('UPDATE schedule_lessons SET status = ?, change_note = ? WHERE id = ?')
      .run(cancelling ? 'cancelled' : moved ? 'moved' : 'changed',
        cancelling ? 'Занятие отменено сотрудником учебного офиса.' : 'Занятие восстановлено сотрудником учебного офиса.', id);
    return { outcome: 'updated', lesson: getLesson(db, row.group_name, id) };
  });
}
