import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';

export default function useApiResource(path, onSessionExpired) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState({ path: null, status: 'loading', data: null, error: '' });
  useEffect(() => {
    let active = true;
    setState({ path, status: 'loading', data: null, error: '' });
    apiRequest(path).then((data) => {
      if (active) setState({ path, status: 'ready', data, error: '' });
    }).catch((error) => {
      if (!active) return;
      if (error.status === 401) onSessionExpired();
      else setState({ path, status: 'error', data: null, error: error.message });
    });
    return () => { active = false; };
  }, [path, attempt, onSessionExpired]);
  return { ...(state.path === path ? state : { status: 'loading', data: null, error: '' }), retry: () => setAttempt((value) => value + 1) };
}
