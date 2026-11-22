import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate } from '../documentRequests.js';
import MessageRecipientPicker from '../components/MessageRecipientPicker.jsx';
import { notifyMessagesChanged } from '../components/MessageBadge.jsx';

function ResourceState({ resource, label }) {
  if (resource.status === 'loading') return <p role="status">{label}</p>;
  if (resource.status === 'error') return <div role="alert"><p className="error-message">{resource.error}</p>
    <button type="button" onClick={resource.retry}>Повторить загрузку</button></div>;
  return null;
}

function Conversation({ id, user, onSessionExpired, onChanged, onBusy, opening }) {
  const base = `/${user.role}/messages/${id}`;
  const resource = useApiResource(base, onSessionExpired);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [readError, setReadError] = useState('');
  const [readThrough, setReadThrough] = useState(0);
  const pending = useRef(null);
  const busy = useRef(false);
  const active = useRef(false);
  const input = useRef(null);
  useEffect(() => { active.current = true; return () => { active.current = false; onBusy(false); }; }, [onBusy]);
  const messages = resource.data?.messages ?? [];
  useEffect(() => {
    if (resource.status !== 'ready' || !messages.length) return;
    let current = true;
    const lastId = messages.at(-1).id;
    if (!messages.some((item) => item.senderId !== user.id && !item.readAt)) return;
    setReadError('');
    apiRequest(`${base}/read`, { method: 'PATCH', body: JSON.stringify({ throughMessageId: lastId }) })
      .then(() => { if (current) { setReadThrough(lastId); onChanged(); } })
      .catch((failure) => {
        if (!current) return;
        if (failure.status === 401) onSessionExpired(); else setReadError(failure.message);
      });
    return () => { current = false; };
  }, [resource.data, resource.status, base, user.id, onSessionExpired, onChanged]);

  async function submit(event) {
    event.preventDefault();
    if (busy.current || opening || !text.trim() || resource.status !== 'ready') return;
    if (!pending.current) pending.current = { text: text.trim(), clientMessageId: crypto.randomUUID() };
    busy.current = true; setSaving(true); onBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(base, { method: 'POST', body: JSON.stringify(pending.current) });
      if (!active.current) return;
      pending.current = null; setText(''); setUncertain(false); setNotice('Сообщение отправлено.');
      resource.retry(); onChanged();
    } catch (failure) {
      if (!active.current) return;
      if (failure.status === 401) onSessionExpired();
      else {
        const unknown = !failure.status || failure.status >= 500;
        setUncertain(unknown);
        if (!unknown) pending.current = null;
        setError(`${failure.message}${unknown ? ' Можно обновить историю или повторить эту отправку: повтор не создаст дубликат.' : ''}`);
      }
    } finally {
      busy.current = false;
      if (active.current) { setSaving(false); onBusy(false); }
    }
  }
  useEffect(() => { if (!saving && resource.status === 'ready') input.current?.focus({ preventScroll: true }); }, [saving, resource.status]);
  return <section className="student-card message-thread" aria-labelledby="thread-title">
    <div className="card-heading"><h2 id="thread-title">{resource.data?.conversation.recipientName ?? 'Переписка'}</h2>
      <button type="button" className="secondary-button" disabled={saving || resource.status === 'loading'} onClick={() => {
        resource.retry(); onChanged();
      }}>Обновить сообщения</button></div>
    <ResourceState resource={resource} label="Загружаем сообщения…" />
    {readError && <p className="error-message" role="alert">Не удалось отметить сообщения прочитанными: {readError} Обновите сообщения.</p>}
    {resource.status === 'ready' && <>
      <p className="muted">Дата и время — московские. Новые сообщения появляются после обновления.</p>
      {!messages.length ? <p className="message-empty">Сообщений пока нет. Напишите первым.</p>
        : <ol className="message-history" aria-label="История переписки">{messages.map((item) => {
          const outgoing = item.senderId === user.id;
          return <li key={item.id} className={`message-bubble ${outgoing ? 'is-outgoing' : 'is-incoming'}`}>
            <div className="message-meta"><strong>{item.senderName}</strong><span>{item.senderRole === 'staff' ? 'Учебный офис' : 'Студент'}{outgoing ? ' · Вы' : ''}</span></div>
            <p className="message-text">{item.text}</p>
            <div className="message-meta"><time dateTime={item.createdAt}>{formatRequestDate(item.createdAt)}</time>
              {!outgoing && !item.readAt && item.id > readThrough && <span>Новое</span>}</div>
          </li>;
        })}</ol>}
    </>}
    <form className="message-compose" onSubmit={submit}>
      <label htmlFor="message-text">Ваше сообщение</label>
      <textarea ref={input} id="message-text" rows={3} maxLength={4000} required value={text}
        disabled={saving || uncertain || opening} aria-describedby="message-length" onChange={(event) => {
          setText(event.target.value); setError(''); setNotice(''); pending.current = null;
        }} />
      <span id="message-length" className="muted">{text.length} / 4000</span>
      {error && <p className="error-message" role="alert">{error}</p>}
      {notice && <p className="document-success" role="status">{notice}</p>}
      <button type="submit" disabled={saving || opening || !text.trim() || resource.status !== 'ready'}>
        {saving ? 'Отправляем…' : uncertain ? 'Повторить эту отправку' : 'Отправить'}</button>
    </form>
  </section>;
}

export default function MessagesPage({ user, conversationId, onNavigate, onSessionExpired }) {
  const base = `/${user.role}/messages`;
  const list = useApiResource(base, onSessionExpired);
  const [showRecipients, setShowRecipients] = useState(false);
  const [opening, setOpening] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  // Стабильный callback нужен, чтобы отметка прочтения не запускала новый запрос при рендере.
  const changedRef = useRef(null);
  changedRef.current = () => { list.retry(); notifyMessagesChanged(); };
  const onChanged = useRef(() => changedRef.current()).current;
  async function open(recipientId) {
    if (busy.current || sending) return;
    busy.current = true; setOpening(true); setError('');
    try {
      const { conversation } = await apiRequest(base, { method: 'POST', body: JSON.stringify({ recipientId }) });
      if (!active.current) return;
      setShowRecipients(false); onChanged(); onNavigate(`${base}/${conversation.id}`);
    } catch (failure) {
      if (!active.current) return;
      if (failure.status === 401) onSessionExpired(); else setError(failure.message);
    } finally { busy.current = false; if (active.current) setOpening(false); }
  }
  return <>
    <div className="page-heading"><p className="eyebrow">Связь с учебным офисом</p><h1>Сообщения</h1>
      <p>Личная переписка {user.role === 'student' ? 'с сотрудниками учебного офиса' : 'со студентами'}.</p></div>
    <div className="messages-workspace">
      <section className="student-card conversation-panel" aria-labelledby="conversations-title">
        <h2 id="conversations-title">Переписки {list.data?.unreadCount > 0 && <span className="message-badge">{list.data.unreadCount}</span>}</h2>
        <div className="message-panel-actions"><button type="button" disabled={opening || sending} aria-expanded={showRecipients}
          onClick={() => { setShowRecipients(!showRecipients); setError(''); }}>Новая переписка</button>
          <button type="button" className="secondary-button" disabled={opening || sending || list.status === 'loading'} onClick={onChanged}>Обновить переписки</button></div>
        {showRecipients && <Recipients key={user.role} base={base} role={user.role} busy={opening || sending} onOpen={open} onSessionExpired={onSessionExpired} />}
        {error && <p className="error-message" role="alert">{error}</p>}
        <ResourceState resource={list} label="Загружаем переписки…" />
        {list.status === 'ready' && (list.data.conversations.length ? <ul className="conversation-list" aria-label="Мои переписки">
          {list.data.conversations.map((item) => <li key={item.id}><button type="button" disabled={opening || sending}
            className={`conversation-link${String(item.id) === conversationId ? ' is-active' : ''}`}
            aria-current={String(item.id) === conversationId ? 'true' : undefined} onClick={() => onNavigate(`${base}/${item.id}`)}>
            <strong>{item.recipientName}</strong>{item.unreadCount > 0 && <span className="message-badge" aria-label={`Непрочитанных: ${item.unreadCount}`}>{item.unreadCount}</span>}
            <span className="conversation-preview">{item.lastText ?? 'Сообщений пока нет'}</span>
            {item.lastMessageAt && <time dateTime={item.lastMessageAt}>{formatRequestDate(item.lastMessageAt)}</time>}
          </button></li>)}
        </ul> : <p className="message-empty">Переписок пока нет. Выберите «Новая переписка», чтобы написать сообщение.</p>)}
      </section>
      {conversationId ? <Conversation key={conversationId} id={conversationId} user={user} onChanged={onChanged}
        opening={opening} onBusy={setSending} onSessionExpired={onSessionExpired} />
        : <section className="student-card message-empty"><h2>Начните разговор</h2><p>Выберите переписку из списка или создайте новую.</p></section>}
    </div>
  </>;
}

function Recipients({ base, role, busy, onOpen, onSessionExpired }) {
  const resource = useApiResource(`${base}/recipients`, onSessionExpired);
  return <div className="message-recipient-panel"><h3>Получатель</h3>
    <ResourceState resource={resource} label="Загружаем получателей…" />
    {resource.status === 'ready' && (resource.data.recipients.length
      ? <MessageRecipientPicker recipients={resource.data.recipients} role={role} busy={busy} onOpen={onOpen} />
      : <p>Доступных получателей пока нет.</p>)}
  </div>;
}
