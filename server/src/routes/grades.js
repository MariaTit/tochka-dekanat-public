import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getGrades } from '../services/grades.js';

export function createGradesRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('student'));
  router.get('/', (request, response) => {
    if (Object.keys(request.query).length) {
      return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются. Доступны только ваши результаты.' });
    }
    // Идентификатор владельца берём только из проверенной серверной сессии.
    response.json(getGrades(db, request.user.id));
  });
  return router;
}
