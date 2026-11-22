import { useEffect, useRef } from 'react';
import { STUDENT_NAVIGATION } from '../studentRoutes.js';
import Icon from './Icon.jsx';
import StudentLink from './StudentLink.jsx';

export default function StudentLayout({ path, onNavigate, children }) {
  const mainRef = useRef(null);
  const title = path === '/student/profile' ? 'Мой профиль'
    : STUDENT_NAVIGATION.find((item) => item.path === path)?.label;

  useEffect(() => {
    document.title = `${title} — Точка`;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    return () => { document.title = 'Точка — цифровой деканат'; };
  }, [path, title]);

  function navigation(className, label) {
    return <nav className={className} aria-label={label}>
      {STUDENT_NAVIGATION.filter((item) => className !== 'mobile-navigation' || item.path !== '/student/notifications').map((item) => {
        const active = item.path === path || (item.path === '/student/more' && path === '/student/profile');
        return <StudentLink key={item.path} to={item.path} onNavigate={onNavigate}
          className={`student-nav-link${active ? ' is-active' : ''}`} aria-current={item.path === path ? 'page' : undefined}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </StudentLink>;
      })}
    </nav>;
  }

  return <div className="student-shell">
    <a className="skip-link" href="#student-content">К содержимому</a>
    <aside className="student-sidebar">
      <StudentLink className="student-brand" to="/student" onNavigate={onNavigate} aria-label="Точка — главная">точка.</StudentLink>
      <p className="sidebar-caption">Цифровой деканат</p>
      {navigation('desktop-navigation', 'Разделы кабинета')}
      <div className="sidebar-footer"><span className="concept-label">Конкурсный прототип</span><p>Твоя точка связи<br />с учебным офисом</p></div>
    </aside>
    <div className="student-workspace">
      <header className="student-header">
        <div><p className="header-caption">Кабинет студента</p><span className="header-section">{title}</span></div>
        <div className="student-header-actions">
        <StudentLink className="notification-header-link" to="/student/notifications" onNavigate={onNavigate}
          aria-label="Уведомления" aria-current={path === '/student/notifications' ? 'page' : undefined}><Icon name="bell" /></StudentLink>
        <StudentLink className="profile-link" to="/student/profile" onNavigate={onNavigate} aria-label="Мой профиль"
          aria-current={path === '/student/profile' ? 'page' : undefined}>
          <span className="avatar"><Icon name="user" /></span><span>Мой профиль</span>
        </StudentLink>
        </div>
      </header>
      <main className="student-content" id="student-content" ref={mainRef} tabIndex={-1}>{children}</main>
      <footer className="student-footer"><p>Точка · Конкурсный прототип</p><p>Все персональные данные вымышлены.</p></footer>
    </div>
    {navigation('mobile-navigation', 'Разделы кабинета — мобильная навигация')}
  </div>;
}
