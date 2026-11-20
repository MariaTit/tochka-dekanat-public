import { useEffect, useRef } from 'react';
import useSchedule from '../hooks/useSchedule.js';
import { formatDate } from '../scheduleDates.js';
import { LESSON_STATUSES } from './LessonCard.jsx';

export default function LessonDetails({ lessonId, onClose, onSessionExpired }) {
  const dialog = useRef(null);
  const state = useSchedule(`/student/schedule/${lessonId}`, onSessionExpired);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() {
    dialog.current.close();
    onClose();
  }
  const lesson = state.data?.lesson;
  return <dialog ref={dialog} className="lesson-dialog" aria-labelledby="lesson-dialog-title" onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="card-heading"><h2 id="lesson-dialog-title">Подробности занятия</h2><button type="button" className="secondary-button" onClick={close} autoFocus>Закрыть</button></div>
    {state.status === 'loading' && <p role="status">Загружаем занятие…</p>}
    {state.status === 'error' && <><p role="alert" className="error-message">{state.error}</p><button type="button" onClick={state.retry}>Повторить загрузку</button></>}
    {lesson && <>
      <h3>{lesson.subject}</h3>
      <dl className="lesson-data">
        <div><dt>Группа</dt><dd>{lesson.group}</dd></div>
        <div><dt>Дата</dt><dd>{formatDate(lesson.date, { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}</dd></div>
        <div><dt>Время (Москва)</dt><dd>{lesson.startTime}–{lesson.endTime}</dd></div>
        <div><dt>Преподаватель</dt><dd>{lesson.teacher}</dd></div>
        <div><dt>Аудитория</dt><dd>{lesson.room}</dd></div>
        <div><dt>Тип занятия</dt><dd>{lesson.type}</dd></div>
        <div><dt>Статус</dt><dd>{LESSON_STATUSES[lesson.status]}</dd></div>
      </dl>
      {lesson.status !== 'scheduled' && <div className="lesson-change"><strong>{lesson.changeNote}</strong>
        {lesson.original && <p>Было: {formatDate(lesson.original.date)} · {lesson.original.startTime}–{lesson.original.endTime}{lesson.original.room ? ` · ${lesson.original.room}` : ''}</p>}
        {lesson.status === 'moved' && <p>Стало: {formatDate(lesson.date)} · {lesson.startTime}–{lesson.endTime} · {lesson.room}</p>}
      </div>}
      {lesson.isDemo && <p className="demo-note">Демонстрационное занятие. Дисциплина, преподаватель и аудитория вымышлены и не являются сведениями университета.</p>}
    </>}
  </dialog>;
}
