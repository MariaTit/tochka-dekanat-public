import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getLesson, getSchedule, isScheduleDate } from '../services/schedule.js';

export function createScheduleRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('student'));
  // Группа всегда берётся из профиля в БД. Клиент не выбирает владельца данных.
  router.get('/', (request, response) => {
    const { from, to } = request.query;
    if (Object.keys(request.query).some((key) => !['from', 'to'].includes(key))
      || !isScheduleDate(from) || !isScheduleDate(to) || from > to
      || (Date.parse(to) - Date.parse(from)) / 86400000 > 61) {
      return response.status(400).json({ error: 'Укажите даты начала и конца в формате ГГГГ-ММ-ДД, период — не более 62 дней.' });
    }
    response.json(getSchedule(db, request.user.studentGroup, { from, to }));
  });
  router.get('/upcoming', (request, response) => {
    if (Object.keys(request.query).length) return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    response.json(getSchedule(db, request.user.studentGroup, { upcoming: true }));
  });
  router.get('/:id', (request, response) => {
    if (!/^[1-9]\d{0,14}$/.test(request.params.id)) return response.status(404).json({ error: 'Занятие не найдено.' });
    const lesson = getLesson(db, request.user.studentGroup, Number(request.params.id));
    if (!lesson) return response.status(404).json({ error: 'Занятие не найдено.' });
    response.json({ lesson });
  });
  return router;
}
