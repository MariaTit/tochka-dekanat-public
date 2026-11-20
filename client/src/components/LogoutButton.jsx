import { useState } from 'react';
import { apiRequest } from '../api.js';
import Icon from './Icon.jsx';

export default function LogoutButton({ onLogout, onLogoutStart, onLogoutEnd }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

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

  return <div className="logout-control">
    <button className="logout-button" type="button" onClick={logout} disabled={pending}>
      <Icon name="logout" />{pending ? 'Выходим…' : 'Выйти из аккаунта'}
    </button>
    {error && <p className="error-message" role="alert">{error}</p>}
  </div>;
}
