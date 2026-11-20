import { useState } from 'react';
import useSchedule from '../hooks/useSchedule.js';
import ScheduleState from '../components/ScheduleState.jsx';
import LessonCard from '../components/LessonCard.jsx';
import LessonDetails from '../components/LessonDetails.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { addDays, dateRange, formatDate, lessonsOnDate, monthEnd, monthStart, nextMonth, todayDate, weekStart } from '../scheduleDates.js';

export default function StudentSchedulePage({ user, onSessionExpired }) {
  const [mode, setMode] = useState('week');
  const [date, setDate] = useState(todayDate);
  const [selected, setSelected] = useState(null);
  const start = mode === 'week' ? weekStart(date) : monthStart(date);
  const end = mode === 'week' ? addDays(start, 6) : monthEnd(date);
  const from = start < '1900-01-01' ? '1900-01-01' : start;
  const to = end > '2100-12-31' ? '2100-12-31' : end;
  const state = useSchedule(`/student/schedule?from=${from}&to=${to}`, onSessionExpired);
  const lessons = state.data?.lessons || [];
  const today = todayDate();
  const selectLesson = (lesson) => setSelected(lesson.id);
  const days = dateRange(from, to);
  const calendarDays = dateRange(weekStart(from), addDays(weekStart(to), 6));

  function move(offset) {
    const destination = mode === 'week' ? addDays(date, offset * 7) : nextMonth(date, offset);
    if (destination >= '1900-01-01' && destination <= '2100-12-31') setDate(destination);
  }
  function dayLessons(day) {
    const items = lessonsOnDate(lessons, day);
    return <section key={day} className={`schedule-day${day === today ? ' schedule-day--today' : ''}`} aria-label={formatDate(day)}>
      <h3>{formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}{day === today && <span className="today-label">Сегодня</span>}</h3>
      {items.length ? <div className="lesson-list">{items.map((lesson) => <LessonCard key={lesson.id} lesson={lesson} displayDate={day} onSelect={selectLesson} />)}</div>
        : <p className="muted">На эту дату занятий нет.</p>}
    </section>;
  }

  return <>
    <div className="page-heading"><p className="eyebrow">Кабинет студента · {user.studentGroup || 'Группа не указана'}</p><h1>Расписание</h1>
      <p>Ваши занятия и изменения. Время указано по Москве.</p></div>
    <section className="student-card schedule-panel" aria-label="Расписание группы">
      <p className="schedule-demo-note">Деморасписание: 20–28 ноября 2026. Все дисциплины, преподаватели и аудитории вымышлены.</p>
      <div className="schedule-toolbar">
        <div className="schedule-modes" role="group" aria-label="Вид расписания">{[['week', 'Неделя'], ['month', 'Месяц'], ['list', 'Список']].map(([value, label]) =>
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
        <button type="button" className="secondary-button" onClick={() => setDate(todayDate())}>Сегодня</button>
      </div>
      <div className="schedule-date-controls">
        <button type="button" className="secondary-button" aria-label={mode === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'} onClick={() => move(-1)}>Ранее</button>
        <div><label htmlFor="schedule-date">Выбрать дату</label><input id="schedule-date" type="date" min="1900-01-01" max="2100-12-31" value={date}
          onChange={(event) => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2100-12-31') setDate(value); }} /></div>
        <button type="button" className="secondary-button" aria-label={mode === 'week' ? 'Следующая неделя' : 'Следующий месяц'} onClick={() => move(1)}>Позднее</button>
      </div>
      <h2 className="schedule-period" aria-live="polite">{mode === 'week' ? `${formatDate(from)} – ${formatDate(to, { day: 'numeric', month: 'long', year: 'numeric' })}`
        : formatDate(date, { month: 'long', year: 'numeric' })}</h2>
      <ScheduleState state={state} allowEmpty={mode === 'month'}>
        {mode === 'month' ? <>
          <div className="month-calendar" role="group" aria-label="Календарь месяца">
            {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
            {calendarDays.map((day) => {
              if (day.slice(0, 7) !== date.slice(0, 7)) return <span key={day} />;
              const items = lessonsOnDate(lessons, day);
              const changes = items.some((lesson) => lesson.status !== 'scheduled');
              return <button type="button" key={day} className={`calendar-day${day === today ? ' calendar-day--today' : ''}`} aria-pressed={date === day}
                aria-current={day === today ? 'date' : undefined} aria-label={`${formatDate(day)}, занятий и переносов: ${items.length}${changes ? ', есть изменения' : ''}`} onClick={() => setDate(day)}>
                <span>{Number(day.slice(-2))}</span>{items.length > 0 && <span className="calendar-count">{items.length}{changes ? '*' : ''}</span>}
              </button>;
            })}
          </div>
          <p className="calendar-legend">Число под датой — занятия и переносы. * — есть изменения.</p>
          {lessonsOnDate(lessons, date).length ? dayLessons(date) : <EmptyState icon="calendar" title="На выбранную дату занятий нет">{formatDate(date)} — свободный день по опубликованному расписанию.</EmptyState>}
        </> : <div className={mode === 'week' ? 'schedule-week' : 'schedule-agenda'}>
          {(mode === 'week' ? days : days.filter((day) => lessonsOnDate(lessons, day).length)).map(dayLessons)}
        </div>}
      </ScheduleState>
    </section>
    {selected !== null && <LessonDetails lessonId={selected} onClose={() => setSelected(null)} onSessionExpired={onSessionExpired} />}
  </>;
}
