import { useState } from 'react';
import { apiRequest } from '../api.js';

export default function LoginPage({ onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError('');
    try {
      const data = await apiRequest('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) });
      onLogin(data.user);
    } catch (failure) { setError(failure.message); }
    finally { setPending(false); setPassword(''); }
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <h2 id="login-title">Вход в личный кабинет</h2>
      <p className="muted">Введите логин и пароль демонстрационного аккаунта.</p>
      <form onSubmit={handleSubmit} aria-busy={pending}>
        <label htmlFor="login">Логин</label>
        <input id="login" name="username" autoComplete="username" autoCapitalize="none" spellCheck="false"
          required maxLength={64} value={login} onChange={(event) => setLogin(event.target.value)} disabled={pending} />
        <label htmlFor="password">Пароль</label>
        <input id="password" name="password" type="password" autoComplete="current-password"
          required maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending}
          aria-describedby={error ? 'login-error' : undefined} />
        {error && <p id="login-error" className="error-message" role="alert">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? 'Входим…' : 'Войти'}</button>
      </form>
      <p className="demo-note">Все аккаунты и персональные данные вымышлены.</p>
    </section>
  );
}
