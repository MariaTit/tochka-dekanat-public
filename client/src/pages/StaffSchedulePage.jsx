import { useRef, useState } from 'react';
import useApiResource from '../hooks/useApiResource.js';
import LessonCard from '../components/LessonCard.jsx';
import StaffLessonEditor from '../components/StaffLessonEditor.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { addDays, formatDate, todayDate, weekStart } from '../scheduleDates.js';

function GroupSchedule({ group, onSessionExpired }) {
  const [date, setDate] = useState(todayDate);
  const [editor, setEditor] = useState(null);
  const [success, setSuccess] = useState('');
  const opener = useRef(null);
  const addButton = useRef(null);
  const start = weekStart(date);
  const end = addDays(start, 6);
  const from = start < '1900-01-01' ? '1900-01-01' : start;
  const to = end > '2100-12-31' ? '2100-12-31' : end;
  const state = useApiResource(`/staff/schedule?group=${encodeURIComponent(group)}&from=${from}&to=${to}`, onSessionExpired);
  function close() {
    setEditor(null);
    (opener.current?.isConnected ? opener.current : addButton.current)?.focus();
  }
  function move(offset) {
    const next = addDays(date, offset * 7);
    if (next >= '1900-01-01' && next <= '2100-12-31') setDate(next);
  }
  return <section className="student-card staff-schedule-panel" aria-labelledby="group-schedule-title">
    <div className="card-heading"><h2 id="group-schedule-title">Расписание группы {group}</h2>
      <button type="button" ref={addButton} onClick={(event) => { opener.current = event.currentTarget; setEditor({ lesson: null }); }}>Добавить занятие</button></div>
    <p className="muted">Время указано по Москве. Изменения видны студентам этой группы; уведомления появятся в их кабинете.</p>
    <div className="schedule-date-controls">
      <button type="button" className="secondary-button" onClick={() => move(-1)} aria-label="Предыдущая неделя">Ранее</button>
      <div><label htmlFor="staff-schedule-date">Выбрать дату</label><input id="staff-schedule-date" type="date" min="1900-01-01" max="2100-12-31" value={date}
        onChange={(event) => { const value = event.target.value; if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '2100-12-31') setDate(value); }} /></div>
      <button type="button" className="secondary-button" onClick={() => move(1)} aria-label="Следующая неделя">Позднее</button>
    </div>
    <div className="staff-actions"><button type="button" className="secondary-button" onClick={() => setDate(todayDate())}>Сегодня</button>
      <button type="button" className="secondary-button" disabled={state.status === 'loading'} onClick={state.retry}>Обновить расписание</button></div>
    <p className="schedule-period">{formatDate(from)} – {formatDate(to, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
    {success && <p className="document-success" role="status">{success}</p>}
    {state.status === 'loading' && <p role="status">Загружаем расписание…</p>}
    {state.status === 'error' && <><p className="error-message" role="alert">{state.error}</p><button type="button" onClick={state.retry}>Повторить загрузку</button></>}
    {state.status === 'ready' && <>
      {!state.data.lessons.length && <EmptyState icon="calendar" title="Занятий за эту неделю нет">Выберите другую дату или добавьте занятие.</EmptyState>}
      <div className="staff-lesson-list">{state.data.lessons.map((lesson) => <LessonCard key={lesson.id} lesson={lesson}
        detailsHint="Открыть управление занятием" onSelect={(selected) => { opener.current = document.activeElement; setEditor({ lesson: selected }); }} />)}</div>
    </>}
    {editor && <StaffLessonEditor group={group} lesson={editor.lesson} date={date} onSessionExpired={onSessionExpired} onClose={close}
      onRefresh={() => { close(); state.retry(); }} onSaved={(lesson, message) => {
        opener.current = addButton.current; close(); setDate(lesson.date); setSuccess(message); state.retry();
      }} />}
  </section>;
}

export default function StaffSchedulePage({ onSessionExpired }) {
  const state = useApiResource('/staff/schedule/groups', onSessionExpired);
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
  const [group, setGroup] = useState('');
  const groups = state.data?.groups ?? [];
  const departments = [...new Set(groups.map((item) => JSON.stringify(item.department)))];
  const courses = [...new Set(groups.filter((item) => JSON.stringify(item.department) === department).map((item) => JSON.stringify(item.course)))];
  const choices = groups.filter((item) => JSON.stringify(item.department) === department && JSON.stringify(item.course) === course);
  return <>
    <div className="page-heading"><p className="eyebrow">Учебный офис</p><h1>Управление расписанием</h1>
      <p>Добавляйте, переносите и отменяйте занятия учебных групп.</p></div>
    <section className="student-card staff-schedule-selection" aria-labelledby="schedule-group-title">
      <h2 id="schedule-group-title">Выбор учебной группы</h2>
      {state.status === 'loading' && <p role="status">Загружаем факультеты и группы…</p>}
      {state.status === 'error' && <><p className="error-message" role="alert">{state.error}</p><button type="button" onClick={state.retry}>Повторить загрузку групп</button></>}
      {state.status === 'ready' && (groups.length ? <div className="staff-schedule-fields">
        <div><label htmlFor="staff-department">Факультет / институт</label><select id="staff-department" value={department} onChange={(event) => { setDepartment(event.target.value); setCourse(''); setGroup(''); }}>
          <option value="">Выберите факультет / институт</option>{departments.map((value) => <option key={value} value={value}>{JSON.parse(value) || 'Не указан в профиле'}</option>)}
        </select></div>
        <div><label htmlFor="staff-course">Курс</label><select id="staff-course" value={course} disabled={!department} onChange={(event) => { setCourse(event.target.value); setGroup(''); }}>
          <option value="">Выберите курс</option>{courses.map((value) => <option key={value} value={value}>{value === 'null' ? 'Не указан в профиле' : `${JSON.parse(value)} курс`}</option>)}
        </select></div>
        <div><label htmlFor="staff-group">Учебная группа</label><select id="staff-group" value={group} disabled={!course} onChange={(event) => setGroup(event.target.value)}>
          <option value="">Выберите группу</option>{choices.map((item) => <option key={item.group} value={item.group}>{item.group}</option>)}
        </select></div>
      </div> : <p>В базе пока нет студентов с указанной учебной группой.</p>)}
    </section>
    {group && <GroupSchedule key={group} group={group} onSessionExpired={onSessionExpired} />}
  </>;
}
