import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { findConversation, getConversations, getMessageRecipients, getMessages, openConversation, readConversation, sendMessage } from '../services/messages.js';

const validId = (id) => Number.isSafeInteger(id) && id > 0;
const fields = (body, keys) => body && typeof body === 'object' && !Array.isArray(body)
  && Object.keys(body).length === keys.length && keys.every((key) => Object.hasOwn(body, key));
const notFound = (response) => response.status(404).json({ error: 'Переписка или адресат не найдены.' });

export function createMessagesRouter(db, role) {
  const router = Router();
  router.use(requireAuth(db), requireRole(role));
  router.use((request, response, next) => {
    if (Object.keys(request.query).length) return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    next();
  });
  router.get('/recipients', (request, response) => response.json({ recipients: getMessageRecipients(db, request.user) }));
  router.get('/', (request, response) => {
    const conversations = getConversations(db, request.user);
    response.json({ conversations, unreadCount: conversations.reduce((sum, item) => sum + item.unreadCount, 0) });
  });
  router.post('/', (request, response) => {
    if (!fields(request.body, ['recipientId']) || !validId(request.body.recipientId)) {
      return response.status(400).json({ error: 'Выберите корректного адресата.' });
    }
    const conversation = openConversation(db, request.user, request.body.recipientId);
    if (!conversation) return notFound(response);
    response.json({ conversation });
  });
  router.param('id', (request, response, next, id) => {
    if (!/^[1-9]\d{0,14}$/.test(id)) return notFound(response);
    next();
  });
  router.get('/:id', (request, response) => {
    const conversation = findConversation(db, request.user, Number(request.params.id));
    if (!conversation) return notFound(response);
    response.json({ conversation, messages: getMessages(db, conversation.id) });
  });
  router.post('/:id', (request, response) => {
    // Права проверяются до любых действий; отправитель всегда берётся из сессии.
    const id = Number(request.params.id);
    if (!findConversation(db, request.user, id)) return notFound(response);
    const body = request.body;
    if (!fields(body, ['text', 'clientMessageId']) || typeof body.text !== 'string'
      || body.text.length > 4000 || !body.text.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(body.text)
      || typeof body.clientMessageId !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(body.clientMessageId)) {
      return response.status(400).json({ error: 'Введите текст от 1 до 4000 символов и корректный идентификатор отправки.' });
    }
    const result = sendMessage(db, request.user, id, body.text.trim(), body.clientMessageId);
    if (result.outcome === 'not_found') return notFound(response);
    if (result.outcome === 'conflict') return response.status(409).json({ error: 'Этот идентификатор отправки уже использован для другого сообщения.' });
    response.status(201).json({ messageId: result.messageId });
  });
  router.patch('/:id/read', (request, response) => {
    if (!fields(request.body, ['throughMessageId']) || !validId(request.body.throughMessageId)) {
      return response.status(400).json({ error: 'Укажите последнее загруженное сообщение.' });
    }
    if (!readConversation(db, request.user, Number(request.params.id), request.body.throughMessageId)) return notFound(response);
    response.json({ read: true });
  });
  return router;
}
