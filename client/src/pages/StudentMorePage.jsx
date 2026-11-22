import Icon from '../components/Icon.jsx';
import StudentLink from '../components/StudentLink.jsx';
import LogoutButton from '../components/LogoutButton.jsx';

export default function StudentMorePage({ onNavigate, ...logoutProps }) {
  return <>
    <div className="page-heading"><p className="eyebrow">Личный кабинет</p><h1>Ещё</h1><p>Профиль и управление входом в аккаунт.</p></div>
    <section className="student-card more-card" aria-labelledby="account-title"><h2 id="account-title">Ваш аккаунт</h2>
      <StudentLink className="account-link" to="/student/notifications" onNavigate={onNavigate}><span className="action-icon"><Icon name="bell" /></span><div><h3>Уведомления</h3><p>Объявления, учебные даты и статусы заявок</p></div></StudentLink>
      <StudentLink className="account-link" to="/student/profile" onNavigate={onNavigate}><span className="action-icon"><Icon name="user" /></span><div><h3>Мой профиль</h3><p>Личные и учебные сведения</p></div></StudentLink>
      <LogoutButton {...logoutProps} />
    </section>
    <p className="more-note">Остальные возможности цифрового деканата будут добавляться по мере разработки.</p>
  </>;
}
