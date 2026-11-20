import { useEffect, useRef } from 'react';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate, requestStatusLabel } from '../documentRequests.js';

export default function DocumentRequestDetails({ requestId, onClose, onSessionExpired }) {
  const dialog = useRef(null);
  const state = useApiResource(`/student/documents/requests/${requestId}`, onSessionExpired);
  useEffect(() => {
    const element = dialog.current;
    element.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  function close() {
    dialog.current.close();
    onClose();
  }
  const request = state.data?.request;
  return <dialog ref={dialog} className="document-dialog" aria-labelledby="document-dialog-title"
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <div className="card-heading"><h2 id="document-dialog-title">Подробности заявки</h2>
      <button type="button" className="secondary-button" onClick={close} autoFocus>Закрыть</button></div>
    {state.status === 'loading' && <p role="status">Загружаем заявку…</p>}
    {state.status === 'error' && <><p role="alert" className="error-message">{state.error}</p>
      <button type="button" onClick={state.retry}>Повторить загрузку заявки</button></>}
    {request && <dl className="document-request-data">
      <div><dt>Номер заявки</dt><dd>№ {request.id}</dd></div>
      <div><dt>Тип документа</dt><dd>{request.documentType.name}</dd></div>
      <div><dt>Дата подачи (Москва)</dt><dd><time dateTime={request.createdAt}>{formatRequestDate(request.createdAt)}</time></dd></div>
      <div><dt>Статус</dt><dd><span className="document-status">{requestStatusLabel(request.status)}</span></dd></div>
      <div><dt>Комментарий</dt><dd className="document-comment">{request.comment ?? 'Не указан'}</dd></div>
    </dl>}
  </dialog>;
}
