import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import { LESSON_STATUSES } from './LessonCard.jsx';

export default function StaffLessonEditor({ group, lesson, date, onClose, onSaved, onRefresh, onSessionExpired }) {
  const [fields, setFields] = useState(() => Object.fromEntries(['subject', 'date', 'startTime', 'endTime', 'room', 'teacher', 'type']
    .map((key) => [key, lesson?.[key] ?? (key === 'date' ? date : key === 'type' ? 'Лекция' : '')])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const dialog = useRef(null);
  const sending = useRef(false);
  const active = useRef(true);
  const cancelled = lesson?.status === 'cancelled';
  useEffect(() => {
    active.current = true;
    const element = dialog.current;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { active.current = false; element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() {
    dialog.current.close();
    onClose();
  }
  async function save(status) {
    if (sending.current || needsRefresh) return;
    if (!status && (fields.endTime <= fields.startTime || !fields.subject.trim() || !fields.room.trim() || !fields.teacher.trim())) {
      setError('Заполните обязательные поля. Окончание занятия должно быть позже начала.'); return;
    }
    sending.current = true; setBusy(true); setError('');
    try {
      const result = await apiRequest(status ? `/staff/schedule/${lesson.id}/status` : lesson ? `/staff/schedule/${lesson.id}` : '/staff/schedule', {
        method: status ? 'PATCH' : lesson ? 'PUT' : 'POST', body: JSON.stringify(status ? { status } : { ...fields, ...(!lesson ? { group } : {}) }),
      });
      if (active.current) {
        dialog.current.close();
        onSaved(result.lesson, result.unchanged ? 'Сведения о занятии не изменились.'
          : status === 'cancelled' ? 'Занятие отменено. Группа уведомлена.' : status === 'restored' ? 'Занятие восстановлено. Группа уведомлена.'
            : lesson ? 'Изменения сохранены. Группа уведомлена.' : 'Занятие добавлено. Группа уведомлена.');
      }
    } catch (failure) {
      if (!active.current) return;
      if (failure.status === 401) onSessionExpired();
      else { setError(failure.message); setNeedsRefresh(failure.status !== 400); }
    } finally {
      sending.current = false;
      if (active.current) setBusy(false);
    }
  }
  const input = (key, label, type = 'text', maxLength) => <label>{label}<input type={type} required value={fields[key]}
    maxLength={maxLength} min={type === 'date' ? '1900-01-01' : undefined} max={type === 'date' ? '2100-12-31' : undefined}
    autoFocus={key === 'subject' && !cancelled} onChange={(event) => setFields((current) => ({ ...current, [key]: event.target.value }))} /></label>;
  return <dialog ref={dialog} className="document-dialog staff-lesson-dialog" aria-labelledby="staff-lesson-title" aria-busy={busy}
    onCancel={(event) => { event.preventDefault(); if (!sending.current) close(); }}>
    <div className="card-heading"><h2 id="staff-lesson-title">{lesson ? 'Управление занятием' : 'Новое занятие'}</h2>
      <button type="button" className="secondary-button" disabled={busy} onClick={close}>Закрыть</button></div>
    <p>Группа: <strong>{group}</strong>{lesson && ` · ${LESSON_STATUSES[lesson.status]}`}</p>
    <p className="muted">Все поля обязательны. Время — московское. Используйте только вымышленные данные.</p>
    {error && <p role="alert" className="error-message">{error}</p>}
    {needsRefresh && <><p>Перед следующим действием обновите расписание и проверьте результат предыдущего запроса.</p>
      <button type="button" onClick={() => { dialog.current.close(); onRefresh(); }}>Обновить и проверить расписание</button></>}
    <form onSubmit={(event) => { event.preventDefault(); save(); }}>
      <fieldset className="staff-schedule-fields" disabled={busy || needsRefresh || cancelled}>
        {input('subject', 'Дисциплина', 'text', 200)}{input('date', 'Дата занятия', 'date')}
        {input('startTime', 'Начало занятия', 'time')}{input('endTime', 'Окончание занятия', 'time')}
        {input('room', 'Аудитория', 'text', 100)}{input('teacher', 'Преподаватель', 'text', 200)}
        <div><label htmlFor="staff-lesson-type">Тип занятия</label><select id="staff-lesson-type" value={fields.type} onChange={(event) => setFields((current) => ({ ...current, type: event.target.value }))} required>
          {['Лекция', 'Практика', 'Лабораторная', 'Семинар'].map((type) => <option key={type}>{type}</option>)}
        </select></div>
      </fieldset>
      <div className="staff-actions">
        {!cancelled && <button type="submit" disabled={busy || needsRefresh}>{busy ? 'Сохраняем…' : lesson ? 'Сохранить изменения' : 'Добавить занятие'}</button>}
        {lesson && <button type="button" className="secondary-button" disabled={busy || needsRefresh}
          onClick={() => save(cancelled ? 'restored' : 'cancelled')}>{busy ? 'Сохраняем…' : cancelled ? 'Восстановить занятие' : 'Отменить занятие'}</button>}
      </div>
    </form>
    {cancelled && <p className="muted">Чтобы изменить сведения, сначала восстановите занятие.</p>}
  </dialog>;
}
