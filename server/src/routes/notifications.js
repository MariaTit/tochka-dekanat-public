import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getNotifications, markNotificationRead } from '../services/notifications.js';

export function createNotificationsRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('student'));
  router.use((request, response, next) => {
    if (Object.keys(request.query).length) {
      return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    }
    next();
  });
  router.get('/', (request, response) => {
    const notifications = getNotifications(db, request.user);
    response.json({ notifications, unreadCount: notifications.filter((item) => !item.readAt).length });
  });
  router.patch('/:id/read', (request, response) => {
    if (!/^[1-9]\d{0,14}$/.test(request.params.id)) {
      return response.status(404).json({ error: 'Уведомление не найдено.' });
    }
    if (request.body !== undefined && (!request.body || typeof request.body !== 'object'
      || Array.isArray(request.body) || Object.keys(request.body).length)) {
      return response.status(400).json({ error: 'Отметка о прочтении не принимает дополнительных полей.' });
    }
    const notification = markNotificationRead(db, request.user, Number(request.params.id));
    if (!notification) return response.status(404).json({ error: 'Уведомление не найдено.' });
    response.json({ notification });
  });
  return router;
}
