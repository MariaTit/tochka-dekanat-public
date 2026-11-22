import { useEffect, useState } from 'react';
import { apiRequest } from '../api.js';

export function notifyMessagesChanged() { window.dispatchEvent(new Event('messages-updated')); }

export default function MessageBadge({ role, path }) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let active = true;
    let version = 0;
    async function refresh() {
      const current = ++version;
      try {
        const data = await apiRequest(`/${role}/messages`);
        if (active && current === version) setCount(data.unreadCount);
      } catch { if (active && current === version) setCount(0); }
    }
    refresh();
    window.addEventListener('messages-updated', refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('messages-updated', refresh); window.removeEventListener('focus', refresh); };
  }, [role, path]);
  return count > 0 ? <span className="message-badge" aria-label={`Непрочитанных сообщений: ${count}`}>{count}</span> : null;
}
