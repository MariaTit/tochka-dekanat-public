import EmptyState from './EmptyState.jsx';

export default function GradesState({ state, children }) {
  if (state.status === 'loading') return <p className="grades-message" role="status">Загружаем успеваемость…</p>;
  if (state.status === 'error') return <div className="grades-message"><p className="error-message" role="alert">{state.error}</p>
    <button type="button" onClick={state.retry}>Повторить загрузку</button></div>;
  if (!state.data.disciplines.length) return <EmptyState icon="grades" title="Учебных результатов пока нет">
    Когда дисциплины и результаты будут опубликованы, они появятся здесь. Отсутствие оценки не означает задолженность.
  </EmptyState>;
  return children;
}
