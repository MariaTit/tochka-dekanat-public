import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  createDocumentRequest, getDocumentRequest, getDocumentRequests, getDocumentType, getDocumentTypes,
} from '../services/documents.js';

export function createDocumentsRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('student'));
  router.use((request, response, next) => {
    if (Object.keys(request.query).length) {
      return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются. Доступны только ваши заявки.' });
    }
    next();
  });

  router.get('/types', (request, response) => {
    response.json({ documentTypes: getDocumentTypes(db) });
  });

  router.get('/requests', (request, response) => {
    response.json({ requests: getDocumentRequests(db, request.user.id) });
  });

  router.post('/requests', (request, response) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['documentTypeCode', 'comment'].includes(key))) {
      return response.status(400).json({ error: 'Передайте тип документа и необязательный комментарий.' });
    }
    if (typeof body.documentTypeCode !== 'string' || body.documentTypeCode.length > 64
      || !getDocumentType(db, body.documentTypeCode)) {
      return response.status(400).json({ error: 'Выберите доступный тип документа.' });
    }
    if (body.comment !== undefined && (typeof body.comment !== 'string'
      || body.comment.length > 1000 || body.comment.includes('\u0000'))) {
      return response.status(400).json({ error: 'Комментарий должен быть строкой не длиннее 1000 символов.' });
    }
    const documentRequest = createDocumentRequest(db, request.user.id, body.documentTypeCode, body.comment?.trim() || null);
    response.location(`/api/student/documents/requests/${documentRequest.id}`)
      .status(201).json({ request: documentRequest });
  });

  router.get('/requests/:id', (request, response) => {
    if (!/^[1-9]\d{0,14}$/.test(request.params.id)) {
      return response.status(404).json({ error: 'Заявка не найдена.' });
    }
    const documentRequest = getDocumentRequest(db, request.user.id, Number(request.params.id));
    if (!documentRequest) return response.status(404).json({ error: 'Заявка не найдена.' });
    response.json({ request: documentRequest });
  });

  return router;
}
