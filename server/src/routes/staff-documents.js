import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  getStaffDocumentRequest, getStaffDocumentRequests, updateDocumentRequestStatus,
} from '../services/documents.js';

export function createStaffDocumentsRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('staff'));
  router.use((request, response, next) => {
    if (Object.keys(request.query).length) {
      return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    }
    next();
  });

  router.get('/requests', (request, response) => {
    response.json({ requests: getStaffDocumentRequests(db) });
  });

  router.param('id', (request, response, next, id) => {
    if (!/^[1-9]\d{0,14}$/.test(id)) {
      return response.status(404).json({ error: 'Заявка не найдена.' });
    }
    next();
  });

  router.get('/requests/:id', (request, response) => {
    const documentRequest = getStaffDocumentRequest(db, Number(request.params.id));
    if (!documentRequest) return response.status(404).json({ error: 'Заявка не найдена.' });
    response.json({ request: documentRequest });
  });

  router.patch('/requests/:id/status', (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['status', 'rejectionReason'].includes(key))
      || !['submitted', 'in_progress', 'ready', 'rejected'].includes(body.status)) {
      return response.status(400).json({ error: 'Передайте допустимый статус и причину только при отклонении заявки.' });
    }
    if (body.status === 'rejected') {
      if (typeof body.rejectionReason !== 'string' || !body.rejectionReason.trim()
        || body.rejectionReason.length > 1000 || body.rejectionReason.includes('\u0000')) {
        return response.status(400).json({ error: 'Укажите причину отклонения: от 1 до 1000 символов.' });
      }
    } else if (Object.hasOwn(body, 'rejectionReason')) {
      return response.status(400).json({ error: 'Причина указывается только при отклонении заявки.' });
    }

    const result = updateDocumentRequestStatus(db, Number(request.params.id), body.status,
      body.status === 'rejected' ? body.rejectionReason.trim() : null);
    if (result.outcome === 'not_found') return response.status(404).json({ error: 'Заявка не найдена.' });
    if (result.outcome === 'conflict') {
      return response.status(409).json({ error: 'Недопустимый переход статуса. Обновите заявку и проверьте её состояние.' });
    }
    response.json({ request: result.request });
  });

  return router;
}
