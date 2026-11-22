import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getSchedule, isScheduleDate } from '../services/schedule.js';
import { changeStaffLessonStatus, createStaffLesson, getScheduleGroups, scheduleGroupExists, updateStaffLesson } from '../services/staff-schedule.js';

const FIELDS = ['subject', 'date', 'startTime', 'endTime', 'room', 'teacher', 'type'];
const TYPES = ['Лекция', 'Практика', 'Лабораторная', 'Семинар'];
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const isTime = (value) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

function lessonFields(body, creating) {
  if (!isObject(body) || Object.keys(body).some((key) => ![...FIELDS, ...(creating ? ['group'] : [])].includes(key))
    || !isText(body.subject, 200) || !isText(body.room, 100) || !isText(body.teacher, 200)
    || !isScheduleDate(body.date) || !isTime(body.startTime) || !isTime(body.endTime)
    || body.endTime <= body.startTime || !TYPES.includes(body.type)) return null;
  return Object.fromEntries(FIELDS.map((key) => [key, body[key].trim()]));
}

export function createStaffScheduleRouter(db) {
  const router = Router();
  router.use(requireAuth(db), requireRole('staff'));
  router.use((request, response, next) => {
    const allowed = request.method === 'GET' && request.path === '/' ? ['group', 'from', 'to'] : [];
    if (Object.keys(request.query).some((key) => !allowed.includes(key))) {
      return response.status(400).json({ error: 'Дополнительные параметры не поддерживаются.' });
    }
    next();
  });
  router.get('/groups', (request, response) => response.json({ groups: getScheduleGroups(db) }));
  router.get('/', (request, response) => {
    const { group, from, to } = request.query;
    if (!isText(group, 100) || !scheduleGroupExists(db, group)) {
      return response.status(400).json({ error: 'Выберите существующую учебную группу.' });
    }
    if (!isScheduleDate(from) || !isScheduleDate(to) || from > to
      || (Date.parse(to) - Date.parse(from)) / 86400000 > 61) {
      return response.status(400).json({ error: 'Укажите корректные даты и период не более 62 дней.' });
    }
    response.json(getSchedule(db, group, { from, to }));
  });
  router.post('/', (request, response) => {
    const fields = lessonFields(request.body, true);
    if (!fields) return response.status(400).json({ error: 'Заполните дисциплину, дату, время начала и окончания, аудиторию, преподавателя и тип занятия. Окончание должно быть позже начала.' });
    if (!isText(request.body.group, 100) || !scheduleGroupExists(db, request.body.group)) {
      return response.status(400).json({ error: 'Выберите существующую учебную группу.' });
    }
    const lesson = createStaffLesson(db, request.body.group, fields);
    response.status(201).json({ lesson });
  });
  router.param('id', (request, response, next, id) => {
    if (!/^[1-9]\d{0,14}$/.test(id)) return response.status(404).json({ error: 'Занятие не найдено.' });
    next();
  });
  const sendResult = (response, result) => {
    if (result.outcome === 'not_found') return response.status(404).json({ error: 'Занятие не найдено.' });
    if (result.outcome === 'conflict') return response.status(409).json({ error: 'Состояние занятия изменилось. Обновите расписание. Отменённое занятие необходимо сначала восстановить.' });
    response.json({ lesson: result.lesson, unchanged: result.outcome === 'unchanged' });
  };
  router.put('/:id', (request, response) => {
    const fields = lessonFields(request.body, false);
    if (!fields) return response.status(400).json({ error: 'Проверьте обязательные поля, дату, время и тип занятия. Окончание должно быть позже начала.' });
    sendResult(response, updateStaffLesson(db, Number(request.params.id), fields));
  });
  router.patch('/:id/status', (request, response) => {
    if (!isObject(request.body) || Object.keys(request.body).length !== 1
      || !['cancelled', 'restored'].includes(request.body.status)) {
      return response.status(400).json({ error: 'Допустимые действия: отмена или восстановление занятия.' });
    }
    sendResult(response, changeStaffLessonStatus(db, Number(request.params.id), request.body.status));
  });
  return router;
}
