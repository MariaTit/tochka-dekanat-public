const IMPORT_NAME = 'demo-grades-2026-autumn-v1';
const POINTS_RULES = 'Демонстрационная шкала: от 0 до 20 баллов за отдельную работу. 0 — известный результат, отсутствие баллов — результат ещё не опубликован. Баллы не переводятся в итоговую оценку и не суммируются.';
const EXAM_RULES = 'Демонстрационная шкала экзамена: 2 — неудовлетворительно, 3 — удовлетворительно, 4 — хорошо, 5 — отлично.';
const CREDIT_RULES = 'Демонстрационный зачёт: «Зачтено» или «Не зачтено». Отсутствие результата не означает задолженность.';

// Вымышленные результаты. Все шкалы заданы явно и хранятся вместе с результатами.
const STUDENTS = [
  { login: 'student1', group: 'ИС-21', subjects: [
    ['is-worlds', 'Демо: цифровые миры', 'Контрольная работа', 18, 'exam', '5'],
    ['is-algorithms', 'Демо: конструктор алгоритмов', 'Практическая работа', 15, 'exam', '4'],
    ['is-data', 'Демо: лаборатория данных', 'Лабораторная работа', 0, 'credit', 'Зачтено'],
    ['is-interfaces', 'Демо: проектирование интерфейсов', 'Проектная работа', null, 'credit', null],
  ] },
  { login: 'student2', group: 'ЭК-22', subjects: [
    ['ek-city', 'Демо: экономика вымышленного города', 'Контрольная работа', 12, 'exam', '3'],
    ['ek-calculations', 'Демо: мастерская расчётов', 'Практическая работа', 19, 'credit', 'Зачтено'],
    ['ek-finance', 'Демо: игровые финансы', 'Проектная работа', 16, 'exam', null],
    ['ek-statistics', 'Демо: статистика вымышленного мира', 'Контрольная работа', null, 'credit', null],
  ] },
];

export function createDemoGrades(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare('SELECT name FROM grades_imports WHERE name = ?').get(IMPORT_NAME)) {
      db.exec('COMMIT');
      return 0;
    }
    const students = STUDENTS.map((item) => {
      const user = db.prepare(`SELECT u.id, u.student_group, r.name AS role FROM users u
        JOIN roles r ON r.id = u.role_id WHERE u.login = ?`).get(item.login);
      if (!user || user.role !== 'student' || user.student_group !== item.group) {
        throw new Error(`Для демооценок нужен существующий студент ${item.login}, группа ${item.group}. Сначала выполните setup.`);
      }
      return { ...item, id: user.id };
    });
    let count = 0;
    for (const student of students) {
      for (const [key, name, controlType, points, type, result] of student.subjects) {
        db.prepare('INSERT INTO disciplines (demo_key, name) VALUES (?, ?)').run(key, name);
        const discipline = db.prepare('SELECT id FROM disciplines WHERE demo_key = ?').get(key);
        const enrollment = db.prepare(`INSERT INTO student_disciplines (student_id, discipline_id, period, is_demo)
          VALUES (?, ?, 'Осенний семестр 2026 · демо', 1)`).run(student.id, discipline.id);
        const enrollmentId = Number(enrollment.lastInsertRowid);
        db.prepare(`INSERT INTO current_results
          (student_discipline_id, control_type, points, max_points, scale_rules, status) VALUES (?, ?, ?, 20, ?, ?)`)
          .run(enrollmentId, controlType, points, POINTS_RULES, points === null ? 'pending' : 'published');
        db.prepare(`INSERT INTO attestations
          (student_discipline_id, type, result, grading_rules, status) VALUES (?, ?, ?, ?, ?)`)
          .run(enrollmentId, type, result, type === 'exam' ? EXAM_RULES : CREDIT_RULES, result === null ? 'pending' : 'published');
        count += 2;
      }
    }
    db.prepare('INSERT INTO grades_imports (name) VALUES (?)').run(IMPORT_NAME);
    db.exec('COMMIT');
    return count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
