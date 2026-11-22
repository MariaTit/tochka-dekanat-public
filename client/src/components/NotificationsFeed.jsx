import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate } from '../documentRequests.js';
import EmptyState from './EmptyState.jsx';
import StudentLink from './StudentLink.jsx';

const KINDS = { news: 'Учебный офис', deadline: 'Учебная дата', schedule: 'Расписание', document: 'Документы' };
const FILTERS = [['all', 'Все'], ['unread', 'Непрочитанные'], ['read', 'Прочитанные']];

export default function NotificationsFeed({ compact = false, onNavigate, onSessionExpired }) {
  const resource = useApiResource('/student/notifications', onSessionExpired);
  const [filter, setFilter] = useState('all');
  const [confirmed, setConfirmed] = useState({});
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [notice, setNotice] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  const listHeading = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);

  const notifications = (resource.data?.notifications || []).map((item) => confirmed[item.id] || item);
  const unread = notifications.filter((item) => !item.readAt).length;
  const counts = { all: notifications.length, unread, read: notifications.length - unread };
  const visible = compact ? notifications.filter((item) => item.important && !item.readAt).slice(0, 3)
    : notifications.filter((item) => filter === 'all' || (filter === 'read' ? Boolean(item.readAt) : !item.readAt));

  async function markRead(item) {
    if (busy.current) return;
    busy.current = true;
    setSaving(item.id); setSaveError(null); setNotice('');
    try {
      const { notification } = await apiRequest(`/student/notifications/${item.id}/read`, { method: 'PATCH', body: '{}' });
      if (!active.current) return;
      if (compact || filter === 'unread') listHeading.current?.focus({ preventScroll: true });
      setConfirmed((current) => ({ ...current, [item.id]: notification }));
      setNotice('Уведомление отмечено прочитанным.');
    } catch (error) {
      if (!active.current) return;
      if (error.status === 401) onSessionExpired();
      else setSaveError({ id: item.id, message: error.message });
    } finally {
      busy.current = false;
      if (active.current) setSaving(null);
    }
  }

  function refresh() {
    setSaveError(null); setNotice(''); resource.retry();
  }

  return <div className={`notifications-feed${compact ? ' notifications-feed--compact' : ''}`}>
    <div className="card-heading notifications-heading">
      <h2 ref={listHeading} tabIndex={-1}>{compact ? 'Важные уведомления' : 'Сообщения учебного офиса'}</h2>
      {compact ? <StudentLink to="/student/notifications" onNavigate={onNavigate}>Все уведомления</StudentLink>
        : <button className="notification-secondary" type="button" onClick={refresh}
          disabled={resource.status === 'loading' || saving !== null}>Обновить список</button>}
    </div>
    {notice && <p className="notification-feedback" role="status">{notice}</p>}
    {resource.status === 'loading' && <p className="notification-state" role="status">Загружаем уведомления…</p>}
    {resource.status === 'error' && <div className="notification-state" role="alert">
      <p className="error-message">{resource.error}</p><button type="button" onClick={refresh}>Повторить загрузку</button>
    </div>}
    {resource.status === 'ready' && <>
      {!compact && <div className="notification-filters" role="group" aria-label="Состояние уведомлений">
        {FILTERS.map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => { setFilter(value); setSaveError(null); }} disabled={saving !== null}>
          {label} <span className="notification-count">{counts[value]}</span>
        </button>)}
      </div>}
      {visible.length === 0 ? <EmptyState icon="bell"
        title={compact ? 'Важных непрочитанных уведомлений нет' : !notifications.length ? 'Уведомлений пока нет'
          : filter === 'unread' ? 'Всё прочитано' : 'Прочитанных уведомлений пока нет'}>
        {compact ? 'Все сообщения и прочитанные уведомления доступны в отдельном разделе.'
          : !notifications.length ? 'Здесь появятся объявления, учебные даты, изменения расписания и статусы заявок.'
            : filter === 'unread' ? 'Новые сообщения появятся здесь. Прочитанные сохранены в соседней вкладке.'
              : 'Отметьте любое сообщение прочитанным — оно появится в этом списке.'}
      </EmptyState> : <ul className="notification-list" aria-label={compact ? 'Важные непрочитанные сообщения' : 'Уведомления'}>
        {visible.map((item) => <li key={item.id}>
          <article className={`notification-card${item.readAt ? ' is-read' : ' is-unread'}`} aria-labelledby={`notification-${item.id}`}>
            <div className="notification-meta"><span>{KINDS[item.kind]}</span>
              <span className="notification-read-status">{item.readAt ? 'Прочитано' : 'Не прочитано'}</span>
              {item.important && <span className="notification-important">Важное</span>}
            </div>
            <h3 id={`notification-${item.id}`}>{item.title}</h3>
            <p className="notification-body">{item.body}</p>
            {item.eventAt && <p className="notification-event">Дата события: <time dateTime={item.eventAt}>{formatRequestDate(item.eventAt)}</time> · Москва</p>}
            <div className="notification-meta"><time dateTime={item.createdAt}>{formatRequestDate(item.createdAt)} · Москва</time>
              {item.isDemo && <span>Демонстрационный пример</span>}</div>
            <div className="notification-actions">
              {!item.readAt && <button type="button" className="notification-secondary" disabled={saving !== null}
                aria-label={`Отметить прочитанным: ${item.title}`} onClick={() => markRead(item)}>
                {saving === item.id ? 'Сохраняем…' : 'Отметить прочитанным'}
              </button>}
              {item.lessonId && <StudentLink to="/student/schedule" onNavigate={onNavigate}>К расписанию</StudentLink>}
              {item.documentRequestId && <StudentLink to="/student/documents" onNavigate={onNavigate}>К заявкам</StudentLink>}
              {item.conversationId && <StudentLink to={`/student/messages/${item.conversationId}`} onNavigate={onNavigate}>К переписке</StudentLink>}
            </div>
            {saveError?.id === item.id && <p className="error-message" role="alert">{saveError.message} Попробуйте отметить снова или обновите список.</p>}
          </article>
        </li>)}
      </ul>}
    </>}
  </div>;
}
