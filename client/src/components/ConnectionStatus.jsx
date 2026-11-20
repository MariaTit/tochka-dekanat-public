import { useEffect, useState } from 'react';

const MESSAGES = {
  loading: 'Проверяем связь с сервером…',
  connected: 'Сервер работает. Соединение установлено.',
  error: 'Нет связи с сервером. Проверьте, что backend запущен, и обновите страницу.',
};

export default function ConnectionStatus() {
  const [status, setStatus] = useState('loading');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timeout = setTimeout(() => controller.abort(), 5000);
    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok || (await response.json()).status !== 'ok') throw new Error();
        if (active) setStatus('connected');
      })
      .catch(() => { if (active) setStatus('error'); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, []);

  return <p className={`connection-status connection-status--${status}`} role="status">{MESSAGES[status]}</p>;
}
