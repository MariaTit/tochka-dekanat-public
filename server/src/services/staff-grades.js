import { getGrades } from './grades.js';

export function getGradeStudents(db) {
  return db.prepare(`SELECT u.id, u.full_name AS fullName,
    nullif(trim(u.department), '') AS department, u.course,
    nullif(trim(u.student_group), '') AS "group"
    FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'student'
    ORDER BY u.department, u.course, u.student_group, u.full_name, u.id`).all();
}

export function gradeStudentExists(db, id) {
  return Boolean(db.prepare(`SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND r.name = 'student'`).get(id));
}

const EXAM_RULES = 'Экзамен: 2 — неудовлетворительно, 3 — удовлетворительно, 4 — хорошо, 5 — отлично.';
const CREDIT_RULES = 'Зачёт: «Зачтено» или «Не зачтено». Отсутствие результата не означает задолженность.';
const DIFFERENTIATED_RULES = 'Дифференцированный зачёт: 2 — «Не зачтено», 3, 4 или 5 — «Зачтено».';

export function saveStaffAttestation(db, studentId, disciplineId, type, fields) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const discipline = db.prepare(`SELECT d.name, sd.period FROM student_disciplines sd
      JOIN disciplines d ON d.id = sd.discipline_id JOIN users u ON u.id = sd.student_id
      JOIN roles r ON r.id = u.role_id
      WHERE sd.id = ? AND sd.student_id = ? AND r.name = 'student'`).get(disciplineId, studentId);
    let outcome = 'not_found';
    if (discipline) {
      const rows = db.prepare('SELECT * FROM attestations WHERE student_discipline_id = ? AND type = ?').all(disciplineId, type);
      const previous = rows[0];
      if (rows.length > 1 || (previous ? previous.revision !== fields.expectedRevision : fields.expectedRevision !== null)) {
        outcome = 'conflict';
      } else if (previous?.status === 'published' && previous.result === fields.result
        && Boolean(previous.is_differentiated) === fields.differentiated && previous.grade === fields.grade) {
        outcome = 'unchanged';
      } else {
        const rules = type === 'exam' ? EXAM_RULES : fields.differentiated ? DIFFERENTIATED_RULES : CREDIT_RULES;
        if (previous) {
          db.prepare(`UPDATE attestations SET result = ?, is_differentiated = ?, grade = ?,
            grading_rules = ?, status = 'published', revision = revision + 1 WHERE id = ?`)
            .run(fields.result, Number(fields.differentiated), fields.grade, rules, previous.id);
        } else {
          db.prepare(`INSERT INTO attestations (student_discipline_id, type, result, grading_rules,
            status, is_differentiated, grade) VALUES (?, ?, ?, ?, 'published', ?, ?)`)
            .run(disciplineId, type, fields.result, rules, Number(fields.differentiated), fields.grade);
        }
        const label = type === 'exam' ? 'Экзамен' : fields.differentiated ? 'Дифференцированный зачёт' : 'Зачёт';
        const result = `${fields.result}${fields.differentiated ? `, оценка ${fields.grade}` : ''}`;
        db.prepare(`INSERT INTO notifications (recipient_id, kind, title, body, important)
          VALUES (?, 'news', ?, ?, 1)`).run(studentId,
          previous?.status === 'published' ? 'Результат аттестации изменён' : 'Выставлен результат аттестации',
          `${discipline.name} · ${discipline.period}. ${label}: ${result}.`);
        outcome = 'saved';
      }
    }
    const grades = ['saved', 'unchanged'].includes(outcome) ? getGrades(db, studentId) : null;
    db.exec('COMMIT');
    return { outcome, grades };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
