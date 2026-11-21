import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../api.js';

const MAX_REASON_LENGTH = 1000;

export default function StaffRequestActions({ request, onSaved, onRefresh, onSessionExpired, onBusyChange }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const editable = ['submitted', 'in_progress'].includes(request.status);

  async function save(status) {
    if (sending.current || needsRefresh || !editable) return;
    if (status === 'rejected' && (!reason.trim() || reason.length > MAX_REASON_LENGTH || reason.includes('\u0000'))) {
      setError('Укажите причину отклонения: от 1 до 1000 символов.');
      return;
    }
    sending.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await apiRequest(`/staff/documents/requests/${request.id}/status`, {
        method: 'PATCH', body: JSON.stringify(status === 'rejected' ? { status, rejectionReason: reason.trim() } : { status }),
      });
      if (active.current) onSaved(result.request);
    } catch (failure) {
      if (!active.current) return;
      if (failure.status === 401) onSessionExpired();
      else {
        setError(failure.message);
        // После конфликта или обрыва связи сначала получаем фактический статус с сервера.
        setNeedsRefresh(failure.status !== 400);
      }
    } finally {
      sending.current = false;
      if (active.current) { setBusy(false); onBusyChange(false); }
    }
  }

  if (!editable) return <p className="staff-final-note">Обработка завершена. Изменение статуса недоступно.</p>;
  return <section className="staff-processing" aria-labelledby="staff-processing-title" aria-busy={busy}>
    <h3 id="staff-processing-title">Обработка заявки</h3>
    {error && <p className="error-message" role="alert">{error}</p>}
    {needsRefresh && <div><p>Перед следующим действием обновите заявку и проверьте сохранённый статус.</p>
      <button type="button" onClick={onRefresh}>Обновить заявку</button></div>}
    {!rejecting && <div className="staff-actions">
      <button type="button" disabled={busy || needsRefresh} onClick={() => save(request.status === 'submitted' ? 'in_progress' : 'ready')}>
        {busy ? 'Сохраняем…' : request.status === 'submitted' ? 'Взять в работу' : 'Отметить готовой'}
      </button>
      <button type="button" className="secondary-button staff-reject-button" disabled={busy || needsRefresh}
        onClick={() => { setRejecting(true); setError(''); }}>Отклонить заявку</button>
    </div>}
    {rejecting && <form className="document-fields" onSubmit={(event) => { event.preventDefault(); save('rejected'); }}>
      <fieldset disabled={busy || needsRefresh}>
        <label htmlFor="rejection-reason">Причина отклонения <span className="document-optional">(обязательно)</span></label>
        <textarea id="rejection-reason" value={reason} onChange={(event) => setReason(event.target.value)} required
          maxLength={MAX_REASON_LENGTH} aria-describedby="rejection-help" autoFocus />
        <div id="rejection-help" className="document-comment-help"><span>Причину увидит студент.</span><span>{reason.length} / {MAX_REASON_LENGTH}</span></div>
        <div className="staff-actions"><button type="submit" disabled={!reason.trim()}>{busy ? 'Сохраняем…' : 'Подтвердить отклонение'}</button>
          <button type="button" className="secondary-button" onClick={() => { setRejecting(false); setError(''); }}>Отмена</button></div>
      </fieldset>
    </form>}
  </section>;
}
