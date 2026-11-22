export function getGrades(db, studentId) {
  const disciplines = db.prepare(`SELECT sd.id, d.name, sd.period, sd.is_demo AS isDemo
    FROM student_disciplines sd JOIN disciplines d ON d.id = sd.discipline_id
    WHERE sd.student_id = ? ORDER BY sd.id`).all(studentId);
  const currentResults = db.prepare(`SELECT cr.id, cr.student_discipline_id AS disciplineId,
    cr.control_type AS controlType, cr.points, cr.max_points AS maxPoints, cr.scale_rules AS scaleRules, cr.status
    FROM current_results cr JOIN student_disciplines sd ON sd.id = cr.student_discipline_id
    WHERE sd.student_id = ? ORDER BY cr.id`).all(studentId);
  const attestations = db.prepare(`SELECT a.id, a.student_discipline_id AS disciplineId,
    a.type, a.result, a.grading_rules AS gradingRules, a.status,
    a.is_differentiated AS differentiated, a.grade, a.revision
    FROM attestations a JOIN student_disciplines sd ON sd.id = a.student_discipline_id
    WHERE sd.student_id = ? ORDER BY a.id`).all(studentId);
  return {
    disciplines: disciplines.map((discipline) => ({ ...discipline, isDemo: Boolean(discipline.isDemo),
      currentResults: currentResults.filter((result) => result.disciplineId === discipline.id),
      attestations: attestations.filter((result) => result.disciplineId === discipline.id)
        .map((result) => ({ ...result, differentiated: Boolean(result.differentiated) })),
    })),
  };
}
