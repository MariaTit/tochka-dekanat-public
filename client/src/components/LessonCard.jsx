import { formatDate } from '../scheduleDates.js';

export const LESSON_STATUSES = { scheduled: 'По расписанию', changed: 'Изменено', moved: 'Перенесено', cancelled: 'Отменено' };

export default function LessonCard({ lesson, displayDate = lesson.date, onSelect }) {
  const movedFrom = lesson.status === 'moved' && displayDate !== lesson.date;
  const time = movedFrom ? lesson.original : lesson;
  return <button type="button" className={`lesson-card lesson-card--${lesson.status}`} onClick={() => onSelect(lesson)}>
    <span className="lesson-card-top"><span className="lesson-time">{time.startTime}–{time.endTime}</span><span className="lesson-type">{lesson.type}</span></span>
    <span className="lesson-date">{formatDate(displayDate, { day: 'numeric', month: 'long', weekday: 'short' })}</span>
    <span className="lesson-subject">{lesson.subject}</span>
    <span>{lesson.teacher}</span><span>Аудитория: {lesson.room}</span>
    {lesson.status !== 'scheduled' && <span className="lesson-change"><strong>{LESSON_STATUSES[lesson.status]}</strong>
      {lesson.status === 'moved' && <span>{movedFrom ? 'На' : 'С'} {formatDate(movedFrom ? lesson.date : lesson.original.date)} · {movedFrom ? lesson.startTime : lesson.original.startTime}</span>}
      {lesson.status !== 'moved' && <span>{lesson.changeNote}</span>}
    </span>}
    <span className="lesson-details-hint">Подробнее о занятии</span>
  </button>;
}
