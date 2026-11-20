import LogoutButton from '../components/LogoutButton.jsx';

export default function DashboardPage({ user, ...logoutProps }) {
  const isStudent = user.role === 'student';

  return (
    <section className="auth-card profile-card" aria-labelledby="dashboard-title">
      <p className="role-label">{isStudent ? 'Кабинет студента' : 'Кабинет сотрудника'}</p>
      <h2 id="dashboard-title">Здравствуйте, {user.fullName}!</h2>
      <dl className="profile-data">
        <div><dt>Роль</dt><dd>{isStudent ? 'Студент' : 'Сотрудник учебного офиса'}</dd></div>
        <div><dt>Логин</dt><dd>{user.login}</dd></div>
        <div><dt>Электронная почта</dt><dd>{user.email}</dd></div>
        {isStudent && <div><dt>Группа</dt><dd>{user.studentGroup || 'Не указана'}</dd></div>}
        <div><dt>Подразделение</dt><dd>{user.department}</dd></div>
      </dl>
      <LogoutButton {...logoutProps} />
      <p className="demo-note">Демонстрационный профиль. Все данные вымышлены.</p>
    </section>
  );
}
