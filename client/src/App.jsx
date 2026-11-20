import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api.js';
import ConnectionStatus from './components/ConnectionStatus.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import StudentLayout from './components/StudentLayout.jsx';
import StudentHomePage from './pages/StudentHomePage.jsx';
import StudentProfilePage from './pages/StudentProfilePage.jsx';
import StudentMorePage from './pages/StudentMorePage.jsx';
import StudentSectionPage from './pages/StudentSectionPage.jsx';
import StudentSchedulePage from './pages/StudentSchedulePage.jsx';
import StudentGradesPage from './pages/StudentGradesPage.jsx';
import './styles/schedule.css';
import './styles/grades.css';
import { isStudentPath } from './studentRoutes.js';

export default function App() {
  const [state, setState] = useState({ status: 'loading', user: null, error: '' });
  const version = useRef(0);
  const busy = useRef(false);
  const [path, setPath] = useState(window.location.pathname);

  const showUser = useCallback((user) => {
    version.current += 1;
    const destination = user.role === 'student'
      ? (isStudentPath(window.location.pathname) ? window.location.pathname : '/student') : '/staff';
    window.history.replaceState(null, '', destination);
    setPath(destination);
    setState({ status: 'authenticated', user, error: '' });
  }, []);

  const showLogin = useCallback(() => {
    version.current += 1;
    window.history.replaceState(null, '', '/login');
    setPath('/login');
    setState({ status: 'anonymous', user: null, error: '' });
  }, []);

  const checkSession = useCallback(async () => {
    if (busy.current) return;
    const current = ++version.current;
    try {
      const { user } = await apiRequest('/auth/me');
      const data = await apiRequest(user.role === 'student' ? '/student' : '/staff');
      if (version.current === current) showUser(data.user);
    } catch (error) {
      if (version.current !== current) return;
      if (error.status === 401) showLogin();
      else setState({ status: 'error', user: null, error: error.message });
    }
  }, [showLogin, showUser]);

  useEffect(() => {
    checkSession();
    const onFocus = () => { if (document.visibilityState === 'visible') checkSession(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('popstate', checkSession);
    const timer = setInterval(onFocus, 60000);
    return () => {
      version.current += 1;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('popstate', checkSession);
    };
  }, [checkSession]);

  function navigate(destination) {
    if (!isStudentPath(destination) || destination === path) return;
    window.history.pushState(null, '', destination);
    setPath(destination);
  }

  const logoutProps = {
    onLogout: showLogin,
    onLogoutStart: () => { busy.current = true; version.current += 1; },
    onLogoutEnd: () => { busy.current = false; },
  };

  if (state.status === 'authenticated' && state.user.role === 'student') {
    let page;
    if (path === '/student/profile') page = <StudentProfilePage user={state.user} />;
    else if (path === '/student/more') page = <StudentMorePage onNavigate={navigate} {...logoutProps} />;
    else if (path === '/student') page = <StudentHomePage user={state.user} onNavigate={navigate} onSessionExpired={showLogin} />;
    else if (path === '/student/schedule') page = <StudentSchedulePage user={state.user} onSessionExpired={showLogin} />;
    else if (path === '/student/grades') page = <StudentGradesPage onSessionExpired={showLogin} />;
    else page = <StudentSectionPage path={path} onNavigate={navigate} />;
    return <StudentLayout key={state.user.id} path={path} onNavigate={navigate}>{page}</StudentLayout>;
  }

  return (
    <main className="start-page">
      <header className="intro">
        <h1 className="project-title" id="project-title">точка.</h1>
        <p className="project-description">Конкурсный прототип цифрового деканата</p>
        <ConnectionStatus />
      </header>
      {state.status === 'loading' && <p role="status">Проверяем сессию…</p>}
      {state.status === 'error' && <section className="auth-card">
        <p className="error-message" role="alert">{state.error}</p>
        <button type="button" onClick={() => { setState({ status: 'loading', user: null, error: '' }); checkSession(); }}>Повторить проверку</button>
      </section>}
      {state.status === 'anonymous' && <LoginPage onLogin={showUser} />}
      {state.status === 'authenticated' && <DashboardPage user={state.user} {...logoutProps} />}
    </main>
  );
}
