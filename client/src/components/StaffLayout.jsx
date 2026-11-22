import LogoutButton from './LogoutButton.jsx';
import MessageBadge from './MessageBadge.jsx';

export default function StaffLayout({ user, path, onNavigate, children, ...logoutProps }) {
  return <div className="staff-shell">
    <a className="skip-link" href="#staff-content">Перейти к содержимому</a>
    <header className="staff-header">
      <div><span className="student-brand">точка.</span><p className="header-caption">Кабинет сотрудника деканата</p></div>
      <div className="staff-account"><span>{user.fullName}</span><LogoutButton {...logoutProps} /></div>
    </header>
    <main className="staff-content" id="staff-content" tabIndex={-1}>
      <nav className="staff-navigation" aria-label="Разделы кабинета сотрудника">
        {[['/staff', 'Заявки студентов'], ['/staff/schedule', 'Расписание'], ['/staff/grades', 'Успеваемость'], ['/staff/messages', 'Сообщения']].map(([href, label]) =>
          <a key={href} href={href} aria-current={path === href || (href === '/staff/messages' && path.startsWith(`${href}/`)) ? 'page' : undefined} onClick={(event) => {
            if (event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
              event.preventDefault(); onNavigate(href);
            }
          }}>{label}{href === '/staff/messages' && <> <MessageBadge role="staff" path={path} /></>}</a>)}
      </nav>
      <details className="staff-profile"><summary>Мой профиль</summary>
        <dl className="student-profile-data">
          <div><dt>ФИО</dt><dd>{user.fullName}</dd></div>
          <div><dt>Роль</dt><dd>Сотрудник учебного офиса</dd></div>
          <div><dt>Логин</dt><dd>{user.login}</dd></div>
          <div><dt>Электронная почта</dt><dd>{user.email}</dd></div>
          <div><dt>Подразделение</dt><dd>{user.department || 'Не указано'}</dd></div>
        </dl>
      </details>
      {children}
    </main>
    <footer className="staff-footer"><span className="concept-label">Конкурсный прототип</span>
      <p>Демонстрационные профили. Все персональные данные вымышлены.</p></footer>
  </div>;
}
