import { useEffect, useState } from 'react';

const STATUS_MESSAGES = {
  loading: 'Проверяем связь с сервером…',
  connected: 'Сервер работает. Соединение установлено.',
  error: 'Нет связи с сервером. Проверьте, что backend запущен, и обновите страницу.',
};

export default function App() {
  const [connectionStatus, setConnectionStatus] = useState('loading');

  useEffect(() => {
    const controller = new AbortController();
    let isActive = true;
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    async function checkHealth() {
      try {
        const response = await fetch('/api/health', { signal: controller.signal });

        if (!response.ok) {
          throw new Error('Сервер вернул ошибку');
        }

        const data = await response.json();

        if (data.status !== 'ok') {
          throw new Error('Неожиданный ответ сервера');
        }

        if (isActive) setConnectionStatus('connected');
      } catch {
        if (isActive) setConnectionStatus('error');
      } finally {
        clearTimeout(timeoutId);
      }
    }

    checkHealth();

    return () => {
      isActive = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  return (
    <main className="start-page">
      <section className="intro" aria-labelledby="project-title">
        <h1 className="project-title" id="project-title">точка.</h1>
        <p className="project-description">Конкурсный прототип цифрового деканата</p>
        <p className={`connection-status connection-status--${connectionStatus}`} role="status">
          {STATUS_MESSAGES[connectionStatus]}
        </p>
      </section>
    </main>
  );
}
