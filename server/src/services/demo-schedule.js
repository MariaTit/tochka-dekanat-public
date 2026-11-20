const IMPORT_NAME = 'demo-schedule-2026-11-v1';

// Только вымышленные сведения для конкурсной демонстрации 20–28 ноября 2026 года.
export function createDemoSchedule(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT name FROM schedule_imports WHERE name = ?').get(IMPORT_NAME)) {
      db.exec('COMMIT');
      return 0;
    }
    const insert = db.prepare(`INSERT INTO schedule_lessons
      (demo_key, group_name, subject, lesson_date, start_time, end_time, teacher, room, lesson_type,
       status, original_date, original_start_time, original_end_time, original_room, change_note, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);
    let count = 0;
    for (const [group, prefix, subjects, teachers] of [
      ['ИС-21', 'is', ['Демо: цифровые миры', 'Демо: конструктор алгоритмов', 'Демо: лаборатория данных'], ['Демо-преподаватель Искрова А. Б.', 'Демо-преподаватель Облачкин В. Г.']],
      ['ЭК-22', 'ek', ['Демо: экономика вымышленного города', 'Демо: мастерская расчётов', 'Демо: игровые финансы'], ['Демо-преподаватель Монеткина Д. Е.', 'Демо-преподаватель Счётов Ж. З.']],
    ]) {
      for (const day of [20, 21, 23, 24, 25, 26, 27, 28]) {
        for (let slot = 0; slot < 2; slot += 1) {
          const changed = day === 23 && slot === 1;
          const moved = day === 24 && slot === 0;
          const cancelled = day === 27 && slot === 1;
          const times = group === 'ИС-21' ? [['09:00', '10:30'], ['10:45', '12:15']] : [['13:00', '14:30'], ['14:45', '16:15']];
          insert.run(`${prefix}-${day}-${slot}`, group, subjects[(day + slot) % subjects.length],
            `2026-11-${moved ? 25 : day}`, moved ? '16:30' : times[slot][0], moved ? '18:00' : times[slot][1],
            teachers[slot], `Демо-${prefix.toUpperCase()}-${changed ? '303' : `10${slot + 1}`}`,
            slot === 0 ? 'Лекция' : (day % 2 ? 'Практика' : 'Лабораторная'),
            moved ? 'moved' : changed ? 'changed' : cancelled ? 'cancelled' : 'scheduled',
            moved || changed ? `2026-11-${day}` : null,
            moved || changed ? times[slot][0] : null, moved || changed ? times[slot][1] : null,
            moved || changed ? `Демо-${prefix.toUpperCase()}-10${slot + 1}` : null,
            moved ? 'Демонстрационный перенос на 25 ноября, 16:30.' : changed ? 'Демонстрационная замена аудитории.' : cancelled ? 'Демонстрационный пример отмены занятия.' : null);
          count += 1;
        }
      }
    }
    db.prepare('INSERT INTO schedule_imports (name) VALUES (?)').run(IMPORT_NAME);
    db.exec('COMMIT');
    return count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
