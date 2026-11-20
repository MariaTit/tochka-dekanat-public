import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';
import useApiResource from '../hooks/useApiResource.js';
import { MAX_COMMENT_LENGTH } from '../documentRequests.js';

export default function DocumentRequestForm({ onCreated, onSessionExpired }) {
  const types = useApiResource('/student/documents/types', onSessionExpired);
  const [documentTypeCode, setDocumentTypeCode] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    if (!types.data?.documentTypes.some((type) => type.code === documentTypeCode)) {
      setError('Выберите тип документа.');
      return;
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      setError('Комментарий должен быть не длиннее 1000 символов.');
      return;
    }
    busy.current = true;
    setSending(true);
    setError('');
    try {
      const data = await apiRequest('/student/documents/requests', {
        method: 'POST', body: JSON.stringify({ documentTypeCode, comment }),
      });
      if (!active.current) return;
      setComment('');
      onCreated(data.request);
    } catch (failure) {
      if (!active.current) return;
      if (failure.status === 401) onSessionExpired();
      else setError(`${failure.message} Если связь прервалась, обновите список заявок перед повторной отправкой.`);
    } finally {
      busy.current = false;
      if (active.current) setSending(false);
    }
  }

  return <section className="student-card document-form-card" aria-labelledby="document-form-title">
    <h2 id="document-form-title">Новая заявка</h2>
    <p className="muted">Выберите справку и отправьте заявку в учебный офис.</p>
    {types.status === 'loading' && <p role="status">Загружаем типы документов…</p>}
    {types.status === 'error' && <><p className="error-message" role="alert">{types.error}</p>
      <button type="button" onClick={types.retry}>Повторить загрузку типов</button></>}
    {types.status === 'ready' && (types.data.documentTypes.length ? <form onSubmit={submit} aria-busy={sending}>
      <fieldset className="document-fields" disabled={sending}>
        <legend>Тип документа</legend>
        <div className="document-type-options">
          {types.data.documentTypes.map((type) => <label className="document-type-option" key={type.code}>
            <input type="radio" name="documentTypeCode" value={type.code} required
              checked={documentTypeCode === type.code} onChange={() => setDocumentTypeCode(type.code)} />
            <span>{type.name}</span>
          </label>)}
        </div>
        <label htmlFor="document-comment">Комментарий <span className="document-optional">(необязательно)</span></label>
        <textarea id="document-comment" rows={4} maxLength={MAX_COMMENT_LENGTH} value={comment}
          onChange={(event) => setComment(event.target.value)} aria-describedby="document-comment-hint document-comment-count" />
        <div className="document-comment-help"><span id="document-comment-hint">До 1000 символов</span>
          <span id="document-comment-count">{comment.length} / {MAX_COMMENT_LENGTH}</span></div>
      </fieldset>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button type="submit" disabled={sending}>{sending ? 'Отправляем заявку…' : 'Отправить заявку'}</button>
      {sending && <p role="status" className="document-form-note">Сохраняем заявку…</p>}
    </form> : <p role="status">Нет доступных типов документов. Попробуйте зайти позже.</p>)}
  </section>;
}
