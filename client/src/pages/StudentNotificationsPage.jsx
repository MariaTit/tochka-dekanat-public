import NotificationsFeed from '../components/NotificationsFeed.jsx';

export default function StudentNotificationsPage(props) {
  return <>
    <div className="page-heading"><p className="eyebrow">Всегда в курсе</p><h1>Уведомления</h1>
      <p>Объявления, важные учебные даты, изменения занятий и статусы ваших заявок.</p>
    </div>
    <section className="student-card" aria-label="Центр уведомлений"><NotificationsFeed {...props} /></section>
  </>;
}
