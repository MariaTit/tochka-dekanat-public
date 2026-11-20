import { useState } from 'react';
import { apiRequest } from '../api.js';

export default function DashboardPage({ user, onLogout, onLogoutStart, onLogoutEnd }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const isStudent = user.role === 'student';

  async function logout() {
    if (pending) return;
    setPending(true);
    setError('');
    onLogoutStart();
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: '{}' });
      onLogout();
    } catch (failure) { setError(failure.message); }
    finally { setPending(false); onLogoutEnd(); }
  }

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
      {error && <p className="error-message" role="alert">{error}</p>}
      <button type="button" onClick={logout} disabled={pending}>{pending ? 'Выходим…' : 'Выйти из аккаунта'}</button>
      <p className="demo-note">Демонстрационный профиль. Все данные вымышлены.</p>
    </section>
  );
}
