import NotificationsFeed from '../components/NotificationsFeed.jsx';
import Icon from '../components/Icon.jsx';
import StudentLink from '../components/StudentLink.jsx';
import UpcomingLessons from '../components/UpcomingLessons.jsx';
import GradesOverview from '../components/GradesOverview.jsx';

const QUICK_ACTIONS = [
  { to: '/student/profile', icon: 'user', title: 'Мой профиль', description: 'Личные и учебные сведения' },
  { to: '/student/schedule', icon: 'calendar', title: 'Расписание', description: 'Занятия вашей группы и изменения' },
  { to: '/student/documents', icon: 'document', title: 'Документы', description: 'Информация о будущем разделе' },
];

export default function StudentHomePage({ user, onNavigate, onSessionExpired }) {
  const firstName = user.fullName?.trim().split(/\s+/)[0];
  return <>
    <section className="welcome-panel" aria-labelledby="welcome-title">
      <div><p className="eyebrow">Твоя точка опоры</p><h1 id="welcome-title">Здравствуйте{firstName ? `, ${firstName}` : ''}!</h1>
        <p className="welcome-description">Учёба, документы и связь с деканатом —<br className="desktop-break" /> всё постепенно собирается здесь.</p>
        <span className="welcome-note">Личный кабинет · Конкурсный прототип</span>
      </div>
      <div className="welcome-symbol" aria-hidden="true"><Icon name="grades" /></div>
    </section>
    <div className="overview-grid">
      <section className="student-card" aria-labelledby="classes-title">
        <div className="card-heading"><h2 id="classes-title">Ближайшие занятия</h2><StudentLink to="/student/schedule" onNavigate={onNavigate}>К расписанию</StudentLink></div>
        <UpcomingLessons onSessionExpired={onSessionExpired} />
      </section>
      <section className="student-card" aria-label="Важные уведомления">
        <NotificationsFeed compact onNavigate={onNavigate} onSessionExpired={onSessionExpired} />
      </section>
    </div>
    <GradesOverview onNavigate={onNavigate} onSessionExpired={onSessionExpired} />
    <section className="quick-actions" aria-labelledby="actions-title"><h2 id="actions-title">Быстрые действия</h2>
      <div className="quick-actions-grid">{QUICK_ACTIONS.map((action) => <StudentLink key={action.to} to={action.to} onNavigate={onNavigate} className="action-card">
        <span className="action-icon"><Icon name={action.icon} /></span><div><h3>{action.title}</h3><p>{action.description}</p></div>
      </StudentLink>)}</div>
    </section>
  </>;
}
