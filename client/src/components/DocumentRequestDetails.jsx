import { useEffect, useRef, useState } from 'react';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate, requestStatusLabel } from '../documentRequests.js';
import StaffRequestActions from './StaffRequestActions.jsx';

export default function DocumentRequestDetails({ requestId, onClose, onSessionExpired, staff = false, onUpdated }) {
  const dialog = useRef(null);
  const state = useApiResource(`/${staff ? 'staff' : 'student'}/documents/requests/${requestId}`, onSessionExpired);
  const [savedRequest, setSavedRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() {
    if (busy) return;
    dialog.current.close();
    onClose();
  }
  function onSaved(request) {
    setSavedRequest(request);
    setBusy(false);
    setSuccess(`Статус «${requestStatusLabel(request.status)}» сохранён.`);
    onUpdated(request);
  }
  const request = savedRequest ?? state.data?.request;
  return <dialog ref={dialog} className="document-dialog" aria-labelledby="document-dialog-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="card-heading"><h2 id="document-dialog-title">Подробности заявки</h2>
      <button type="button" className="secondary-button" onClick={close} disabled={busy} autoFocus>Закрыть</button></div>
    {success && <p className="document-success staff-dialog-success" role="status">{success}</p>}
    {state.status === 'loading' && <p role="status">Загружаем заявку…</p>}
    {state.status === 'error' && <><p role="alert" className="error-message">{state.error}</p>
      <button type="button" onClick={state.retry}>Повторить загрузку заявки</button></>}
    {request && <dl className="document-request-data">
      <div><dt>Номер заявки</dt><dd>№ {request.id}</dd></div>
      {staff && <>
        <div><dt>Студент</dt><dd>{request.student.fullName}</dd></div>
        <div><dt>Группа</dt><dd>{request.student.studentGroup || 'Не указана'}</dd></div>
        <div><dt>Факультет / институт</dt><dd>{request.student.department || 'Не указан'}</dd></div>
        <div><dt>Электронная почта</dt><dd>{request.student.email || 'Не указана'}</dd></div>
      </>}
      <div><dt>Тип документа</dt><dd>{request.documentType.name}</dd></div>
      <div><dt>Дата подачи (Москва)</dt><dd><time dateTime={request.createdAt}>{formatRequestDate(request.createdAt)}</time></dd></div>
      <div><dt>Статус</dt><dd><span className="document-status">{requestStatusLabel(request.status)}</span></dd></div>
      <div><dt>Комментарий</dt><dd className="document-comment">{request.comment ?? 'Не указан'}</dd></div>
      {request.status === 'rejected' && <div><dt>Причина отклонения</dt>
        <dd className="document-comment">{request.rejectionReason ?? 'Не указана'}</dd></div>}
    </dl>}
    {staff && request && <StaffRequestActions key={request.status} request={request} onSaved={onSaved}
      onRefresh={() => { setSavedRequest(null); setSuccess(''); state.retry(); }}
      onSessionExpired={onSessionExpired} onBusyChange={setBusy} />}
  </dialog>;
}
