import { useState } from 'react';
import EmptyState from '../components/EmptyState.jsx';
import DocumentRequestForm from '../components/DocumentRequestForm.jsx';
import DocumentRequestDetails from '../components/DocumentRequestDetails.jsx';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate, requestStatusLabel } from '../documentRequests.js';

export default function StudentDocumentsPage({ onSessionExpired }) {
  const state = useApiResource('/student/documents/requests', onSessionExpired);
  const [confirmedRequests, setConfirmedRequests] = useState([]);
  const [createdId, setCreatedId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // Только подтверждённые сервером заявки остаются видны во время обновления списка.
  const requests = [...new Map([
    ...confirmedRequests.map((request) => [request.id, request]),
    ...(state.data?.requests ?? []).map((request) => [request.id, request]),
  ]).values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

  function onCreated(request) {
    setConfirmedRequests((previous) => [request, ...previous]);
    setCreatedId(request.id);
    state.retry();
  }

  return <>
    <div className="page-heading"><p className="eyebrow">Кабинет студента</p><h1>Документы</h1>
      <p>Заказывайте справки и просматривайте свои заявки.</p></div>
    {createdId !== null && <p className="document-success" role="status" key={createdId}>
      Заявка № {createdId} успешно отправлена. Статус — «Подана».
    </p>}
    <div className="documents-layout">
      <DocumentRequestForm onCreated={onCreated} onSessionExpired={onSessionExpired} />
      <section className="student-card document-requests" aria-labelledby="document-requests-title">
        <div className="card-heading"><h2 id="document-requests-title">Мои заявки</h2>
          <button type="button" className="secondary-button" onClick={state.retry} disabled={state.status === 'loading'}>Обновить список</button></div>
        <p className="document-list-note">Новые заявки — первыми. Даты и время — московские.</p>
        {state.status === 'loading' && <p role="status">Загружаем заявки…</p>}
        {state.status === 'error' && <><p className="error-message" role="alert">{state.error}</p>
          <button type="button" onClick={state.retry}>Повторить загрузку списка</button></>}
        {state.status === 'ready' && !requests.length && <EmptyState icon="document" title="Заявок пока нет">
          Выберите нужную справку в форме и отправьте первую заявку.
        </EmptyState>}
        {requests.length > 0 && <ul className="document-request-list">
          {requests.map((request) => <li key={request.id}>
            <button type="button" className="document-request-card" onClick={() => setSelectedId(request.id)} aria-haspopup="dialog">
              <span className="document-request-top"><span className="document-request-number">Заявка № {request.id}</span>
                <span className="document-status">{requestStatusLabel(request.status)}</span></span>
              <span className="document-request-name">{request.documentType.name}</span>
              <span className="document-request-date">Подана <time dateTime={request.createdAt}>{formatRequestDate(request.createdAt)}</time></span>
              <span className="document-details-hint">Посмотреть подробности</span>
            </button>
          </li>)}
        </ul>}
      </section>
    </div>
    {selectedId !== null && <DocumentRequestDetails key={selectedId} requestId={selectedId}
      onClose={() => setSelectedId(null)} onSessionExpired={onSessionExpired} />}
  </>;
}
