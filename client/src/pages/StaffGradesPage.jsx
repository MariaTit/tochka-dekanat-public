import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import useApiResource from '../hooks/useApiResource.js';
import GradesResults from '../components/GradesResults.jsx';

function ResourceState({ state, label }) {
  if (state.status === 'loading') return <p role="status">{label}</p>;
  if (state.status === 'error') return <><p className="error-message" role="alert">{state.error}</p>
    <button type="button" onClick={state.retry}>Повторить загрузку</button></>;
  return null;
}

function AttestationEditor({ studentId, discipline, type, onSaved, onBusy, onEdited, onRefresh, onSessionExpired }) {
  const matches = discipline.attestations.filter((item) => item.type === type);
  const existing = matches[0];
  const [result, setResult] = useState(existing?.result ?? '');
  const [differentiated, setDifferentiated] = useState(existing?.differentiated ?? false);
  const [grade, setGrade] = useState(existing?.grade?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [refreshRequired, setRefreshRequired] = useState(false);
  const busy = useRef(false);
  const saveButton = useRef(null);
  const refreshButton = useRef(null);
  const focusAfterSave = useRef(false);
  useEffect(() => {
    if (!saving && focusAfterSave.current) {
      (refreshRequired ? refreshButton.current : saveButton.current)?.focus();
      focusAfterSave.current = false;
    }
  }, [saving, refreshRequired]);
  const exam = type === 'exam';
  async function submit(event) {
    event.preventDefault();
    if (busy.current || refreshRequired || matches.length > 1) return;
    busy.current = true; setSaving(true); onBusy(true); setError('');
    try {
      const data = await apiRequest(`/staff/grades/students/${studentId}/disciplines/${discipline.id}/${type}`, {
        method: 'PUT', body: JSON.stringify({ result, differentiated, grade: differentiated ? Number(grade) : null,
          expectedRevision: existing?.revision ?? null }),
      });
      onSaved(data, data.unchanged ? 'Результат уже сохранён. Изменений нет.' : 'Результат сохранён. Студенту отправлено уведомление.');
    } catch (failure) {
      if (failure.status === 401) onSessionExpired();
      else {
        const uncertain = !failure.status || failure.status >= 500 || failure.status === 409;
        setRefreshRequired(uncertain);
        setError(`${failure.message}${uncertain ? ' Обновите результаты, чтобы проверить сохранение перед повторной попыткой.' : ''}`);
      }
    } finally { busy.current = false; focusAfterSave.current = true; setSaving(false); onBusy(false); }
  }
  return <form className="staff-grade-editor" onSubmit={submit} aria-labelledby="attestation-editor-title">
    <h3 id="attestation-editor-title">{existing?.status === 'published' ? 'Изменить результат' : 'Выставить результат'}</h3>
    <p className="muted">{exam ? 'Экзамен: оценка по пятибалльной шкале.' : 'Выберите вид зачёта и результат. Для дифференцированного зачёта укажите также оценку.'}</p>
    {matches.length > 1 && <p role="alert" className="error-message">В базе найдены несколько записей этой аттестации. Сохранение недоступно до уточнения данных; прежние записи сохранены.</p>}
    <fieldset className="staff-schedule-fields" disabled={saving || refreshRequired || matches.length > 1}>
      {!exam && <div><label htmlFor="credit-mode">Вид зачёта</label><select id="credit-mode" value={differentiated ? 'differentiated' : 'regular'} onChange={(event) => {
        setDifferentiated(event.target.value === 'differentiated'); setGrade(''); onEdited();
      }}><option value="regular">Обычный зачёт</option><option value="differentiated">Дифференцированный зачёт</option></select></div>}
      <div><label htmlFor="attestation-result">{exam ? 'Оценка за экзамен' : 'Результат зачёта'}</label>
        <select id="attestation-result" required value={result} onChange={(event) => { setResult(event.target.value); setGrade(''); onEdited(); }}>
          <option value="">Выберите результат</option>
          {(exam ? ['2', '3', '4', '5'] : ['Зачтено', 'Не зачтено']).map((value) => <option key={value} value={value}>{value}</option>)}
        </select></div>
      {differentiated && <div><label htmlFor="credit-grade">Оценка за дифференцированный зачёт</label>
        <select id="credit-grade" required disabled={!result} value={grade} onChange={(event) => { setGrade(event.target.value); onEdited(); }}>
          <option value="">Выберите оценку</option>{(result === 'Не зачтено' ? ['2'] : ['3', '4', '5']).map((value) => <option key={value} value={value}>{value}</option>)}
        </select></div>}
    </fieldset>
    {differentiated && <p className="muted">2 — «Не зачтено», 3–5 — «Зачтено».</p>}
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="staff-actions"><button ref={saveButton} type="submit" disabled={saving || refreshRequired || matches.length > 1}>{saving ? 'Сохраняем…' : 'Сохранить результат'}</button>
      {refreshRequired && <button ref={refreshButton} type="button" className="secondary-button" onClick={onRefresh}>Обновить результаты перед повтором</button>}</div>
  </form>;
}

function DisciplineResults({ studentId, initialDiscipline, onSessionExpired, onBusy, onRefresh }) {
  const [discipline, setDiscipline] = useState(initialDiscipline);
  const [type, setType] = useState(initialDiscipline.attestations[0]?.type ?? 'exam');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  return <section className="student-card staff-grade-results" aria-labelledby="discipline-results-title">
    <h2 id="discipline-results-title">{discipline.name}</h2><p className="grade-period">{discipline.period}</p>
    {discipline.isDemo && <p className="grades-demo-note">Учебные данные этой дисциплины демонстрационные.</p>}
    <h3>Текущие результаты</h3><GradesResults disciplines={[discipline]} current />
    <h3>Итоговая аттестация</h3><GradesResults disciplines={[discipline]} />
    <div className="staff-schedule-fields"><div><label htmlFor="attestation-type">Вид аттестации</label>
      <select id="attestation-type" disabled={saving} value={type} onChange={(event) => { setType(event.target.value); setSuccess(''); }}>
        <option value="exam">Экзамен</option><option value="credit">Зачёт</option></select></div></div>
    {success && <p className="document-success" role="status">{success}</p>}
    <AttestationEditor key={type} studentId={studentId} discipline={discipline} type={type}
      onEdited={() => setSuccess('')}
      onSessionExpired={onSessionExpired} onRefresh={onRefresh} onBusy={(value) => { setSaving(value); onBusy(value); if (value) setSuccess(''); }}
      onSaved={(data, message) => {
        setDiscipline(data.disciplines.find((item) => item.id === discipline.id)); setSuccess(message);
      }} />
  </section>;
}

function StudentResults({ studentId, onSessionExpired, onBusy, busy }) {
  const state = useApiResource(`/staff/grades/students/${studentId}`, onSessionExpired);
  const [disciplineId, setDisciplineId] = useState('');
  const discipline = state.data?.disciplines.find((item) => String(item.id) === disciplineId);
  return <>
    <section className="student-card staff-grade-selection" aria-labelledby="discipline-selection-title">
      <div className="card-heading"><h2 id="discipline-selection-title">Дисциплины студента</h2>
        <button type="button" className="secondary-button" disabled={busy || state.status === 'loading'} onClick={state.retry}>Обновить результаты</button></div>
      <ResourceState state={state} label="Загружаем дисциплины и результаты студента…" />
      {state.status === 'ready' && (state.data.disciplines.length ? <div className="staff-schedule-fields"><div>
        <label htmlFor="grade-discipline">Дисциплина и учебный период</label><select id="grade-discipline" disabled={busy} value={disciplineId} onChange={(event) => setDisciplineId(event.target.value)}>
          <option value="">Выберите дисциплину</option>{state.data.disciplines.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.period}</option>)}
        </select></div></div> : <p>У этого студента пока нет дисциплин в базе.</p>)}
    </section>
    {discipline && state.status === 'ready' && <DisciplineResults key={discipline.id} studentId={studentId} initialDiscipline={discipline}
      onSessionExpired={onSessionExpired} onBusy={onBusy} onRefresh={state.retry} />}
  </>;
}

export default function StaffGradesPage({ onSessionExpired }) {
  const state = useApiResource('/staff/grades/students', onSessionExpired);
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
  const [group, setGroup] = useState('');
  const [studentId, setStudentId] = useState('');
  const [busy, setBusy] = useState(false);
  const students = state.data?.students ?? [];
  const departments = [...new Set(students.map((item) => JSON.stringify(item.department)))];
  const inDepartment = students.filter((item) => JSON.stringify(item.department) === department);
  const courses = [...new Set(inDepartment.map((item) => JSON.stringify(item.course)))];
  const inCourse = inDepartment.filter((item) => JSON.stringify(item.course) === course);
  const groups = [...new Set(inCourse.map((item) => JSON.stringify(item.group)))];
  const inGroup = inCourse.filter((item) => JSON.stringify(item.group) === group);
  return <>
    <div className="page-heading"><p className="eyebrow">Учебный офис</p><h1>Успеваемость</h1>
      <p>Выберите студента и дисциплину, проверьте результаты и выставьте итоговую аттестацию.</p></div>
    <section className="student-card staff-grade-selection" aria-labelledby="grade-student-title">
      <h2 id="grade-student-title">Выбор студента</h2>
      <ResourceState state={state} label="Загружаем факультеты, группы и студентов…" />
      {state.status === 'ready' && (students.length ? <fieldset className="staff-schedule-fields" disabled={busy}>
        <div><label htmlFor="grade-department">Факультет / институт</label><select id="grade-department" value={department} onChange={(event) => {
          setDepartment(event.target.value); setCourse(''); setGroup(''); setStudentId('');
        }}><option value="">Выберите факультет / институт</option>{departments.map((value) => <option key={value} value={value}>{JSON.parse(value) ?? 'Не указан в профиле'}</option>)}</select></div>
        <div><label htmlFor="grade-course">Курс</label><select id="grade-course" value={course} disabled={!department} onChange={(event) => {
          setCourse(event.target.value); setGroup(''); setStudentId('');
        }}><option value="">Выберите курс</option>{courses.map((value) => <option key={value} value={value}>{value === 'null' ? 'Не указан в профиле' : `${JSON.parse(value)} курс`}</option>)}</select></div>
        <div><label htmlFor="grade-group">Учебная группа</label><select id="grade-group" value={group} disabled={!course} onChange={(event) => {
          setGroup(event.target.value); setStudentId('');
        }}><option value="">Выберите группу</option>{groups.map((value) => <option key={value} value={value}>{JSON.parse(value) ?? 'Не указана в профиле'}</option>)}</select></div>
        <div><label htmlFor="grade-student">ФИО студента</label><select id="grade-student" value={studentId} disabled={!group} onChange={(event) => setStudentId(event.target.value)}>
          <option value="">Выберите студента</option>{inGroup.map((item) => <option key={item.id} value={item.id}>{item.fullName}</option>)}</select></div>
      </fieldset> : <p>В базе пока нет студентов.</p>)}
    </section>
    {studentId && <StudentResults key={studentId} studentId={studentId} onSessionExpired={onSessionExpired} onBusy={setBusy} busy={busy} />}
  </>;
}
