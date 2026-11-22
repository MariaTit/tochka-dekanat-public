import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getGrades } from '../services/grades.js';
import { getGradeStudents, gradeStudentExists, saveStaffAttestation } from '../services/staff-grades.js';

function validFields(body, type) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['result', 'differentiated', 'grade', 'expectedRevision'].includes(key))
    || typeof body.differentiated !== 'boolean'
    || !(body.expectedRevision === null || (Number.isSafeInteger(body.expectedRevision) && body.expectedRevision >= 0))) return false;
  if (type === 'exam') return ['2', '3', '4', '5'].includes(body.result) && !body.differentiated && body.grade === null;
  if (!['Зачтено', 'Не зачтено'].includes(body.result)) return false;
  if (!body.differentiated) return body.grade === null;
  return Number.isInteger(body.grade) && [2, 3, 4, 5].includes(body.grade)
    && body.result === (body.grade === 2 ? 'Не зачтено' : 'Зачтено');
}

export function createStaffGradesRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('staff'));
  router.use((request, response, next) => {
    if (Object.keys(request.query).length) return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    next();
  });
  router.get('/students', (request, response) => response.json({ students: getGradeStudents(db) }));
  for (const name of ['studentId', 'disciplineId']) router.param(name, (request, response, next, id) => {
    if (!/^[1-9]\d{0,14}$/.test(id)) return response.status(404).json({ error: 'Студент или дисциплина не найдены.' });
    next();
  });
  router.get('/students/:studentId', (request, response) => {
    const id = Number(request.params.studentId);
    if (!gradeStudentExists(db, id)) return response.status(404).json({ error: 'Студент не найден.' });
    response.json(getGrades(db, id));
  });
  router.put('/students/:studentId/disciplines/:disciplineId/:type', (request, response) => {
    const { studentId, disciplineId, type } = request.params;
    if (!['exam', 'credit'].includes(type) || !validFields(request.body, type)) {
      return response.status(400).json({ error: 'Проверьте вид аттестации и результат. Для экзамена допустимы 2–5; для дифференцированного зачёта 2 означает «Не зачтено», 3–5 — «Зачтено».' });
    }
    const saved = saveStaffAttestation(db, Number(studentId), Number(disciplineId), type, request.body);
    if (saved.outcome === 'not_found') return response.status(404).json({ error: 'Дисциплина этого студента не найдена.' });
    if (saved.outcome === 'conflict') return response.status(409).json({ error: 'Результаты изменились или найдены прежние дубликаты. Обновите результаты перед сохранением.' });
    response.json({ ...saved.grades, unchanged: saved.outcome === 'unchanged' });
  });
  return router;
}
