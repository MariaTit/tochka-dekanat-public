import EmptyState from './EmptyState.jsx';

export default function ScheduleState({ state, emptyTitle = 'На выбранный период занятий нет', allowEmpty = false, children }) {
  if (state.status === 'loading') return <p className="schedule-message" role="status">Загружаем расписание…</p>;
  if (state.status === 'error') return <div className="schedule-message"><p className="error-message" role="alert">{state.error}</p>
    <button type="button" onClick={state.retry}>Повторить загрузку</button></div>;
  if (!state.data.hasSchedule) return <EmptyState icon="calendar" title="Расписание пока не опубликовано">
    {state.data.group ? `Для группы ${state.data.group} ещё нет расписания.` : 'В профиле не указана учебная группа. Обратитесь в учебный офис.'}
  </EmptyState>;
  if (!allowEmpty && !state.data.lessons.length) return <EmptyState icon="calendar" title={emptyTitle}>Попробуйте выбрать другую дату.</EmptyState>;
  return children;
}
