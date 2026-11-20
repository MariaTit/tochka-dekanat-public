import useApiResource from '../hooks/useApiResource.js';
import GradesState from './GradesState.jsx';
import StudentLink from './StudentLink.jsx';

export default function GradesOverview({ onNavigate, onSessionExpired }) {
  const state = useApiResource('/student/grades', onSessionExpired);
  const disciplines = state.data?.disciplines || [];
  const current = disciplines.flatMap((discipline) => discipline.currentResults);
  const attestations = disciplines.flatMap((discipline) => discipline.attestations);
  if (state.status === 'ready' && !current.length && !attestations.length) return null;
  const pending = [...current, ...attestations].filter((result) => result.status === 'pending').length;
  return <section className="student-card grades-overview" aria-labelledby="grades-overview-title">
    <div className="card-heading"><h2 id="grades-overview-title">Успеваемость</h2>
      <StudentLink to="/student/grades" onNavigate={onNavigate}>Все результаты</StudentLink></div>
    <GradesState state={state}>
      <dl className="grades-counts">
        <div><dt>Дисциплин</dt><dd>{disciplines.length}</dd></div>
        <div><dt>Работ опубликовано</dt><dd>{current.filter((result) => result.status === 'published').length}</dd></div>
        <div><dt>Аттестаций выставлено</dt><dd>{attestations.filter((result) => result.status === 'published').length}</dd></div>
      </dl>
      {pending > 0 && <p className="grades-footnote">Ожидают публикации: {pending}. Отсутствие результата не означает задолженность.</p>}
      {disciplines.some((discipline) => discipline.isDemo) && <p className="demo-note">Вымышленные результаты из демонстрационной базы.</p>}
    </GradesState>
  </section>;
}
