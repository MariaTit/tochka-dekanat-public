import { useRef, useState } from 'react';
import LogoutButton from '../components/LogoutButton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import DocumentRequestDetails from '../components/DocumentRequestDetails.jsx';
import useApiResource from '../hooks/useApiResource.js';
import { formatRequestDate, requestStatusLabel } from '../documentRequests.js';

const FILTERS = ['all', 'submitted', 'in_progress', 'ready', 'rejected'];

export default function StaffDocumentsPage({ user, onSessionExpired, ...logoutProps }) {
  const state = useApiResource('/staff/documents/requests', onSessionExpired);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [success, setSuccess] = useState('');
  const refreshButton = useRef(null);
  const opener = useRef(null);
  const requests = state.data?.requests ?? [];
  const filteredRequests = requests.filter((request) => filter === 'all' || request.status === filter);

  function onUpdated(request) {
    setSuccess(`Заявка № ${request.id}: статус «${requestStatusLabel(request.status)}» сохранён.`);
    state.retry();
  }

  function onClose() {
    setSelectedId(null);
    (opener.current?.isConnected ? opener.current : refreshButton.current)?.focus();
  }

  return <div className="staff-shell">
    <a className="skip-link" href="#staff-content">Перейти к заявкам</a>
    <header className="staff-header">
      <div><span className="student-brand">точка.</span><p className="header-caption">Кабинет сотрудника деканата</p></div>
      <div className="staff-account"><span>{user.fullName}</span><LogoutButton {...logoutProps} /></div>
    </header>
    <main className="staff-content" id="staff-content" tabIndex={-1}>
      <div className="page-heading"><p className="eyebrow">Учебный офис</p><h1>Заявки студентов</h1>
        <p>Просматривайте обращения и готовьте справки для студентов.</p></div>
      <details className="staff-profile"><summary>Мой профиль</summary>
        <dl className="student-profile-data">
          <div><dt>ФИО</dt><dd>{user.fullName}</dd></div>
          <div><dt>Роль</dt><dd>Сотрудник учебного офиса</dd></div>
          <div><dt>Логин</dt><dd>{user.login}</dd></div>
          <div><dt>Электронная почта</dt><dd>{user.email}</dd></div>
          <div><dt>Подразделение</dt><dd>{user.department || 'Не указано'}</dd></div>
        </dl>
      </details>
      {success && <p className="document-success" role="status">{success}</p>}
      <section className="student-card" aria-labelledby="staff-requests-title">
        <div className="card-heading"><h2 id="staff-requests-title">Все заявки</h2>
          <button ref={refreshButton} type="button" className="secondary-button" onClick={state.retry}
            disabled={state.status === 'loading'}>Обновить список</button></div>
        <div className="staff-filters" role="group" aria-label="Фильтр по статусу">
          {FILTERS.map((status) => <button type="button" key={status} aria-pressed={filter === status}
            className="secondary-button" onClick={() => setFilter(status)}>
            {status === 'all' ? 'Все' : requestStatusLabel(status)}
            {state.status === 'ready' && <span className="staff-filter-count">{status === 'all' ? requests.length : requests.filter((request) => request.status === status).length}</span>}
          </button>)}
        </div>
        <p className="document-list-note">Новые заявки — первыми. Даты и время — московские. Откройте заявку для обработки.</p>
        {state.status === 'loading' && <p role="status">Загружаем заявки…</p>}
        {state.status === 'error' && <><p className="error-message" role="alert">{state.error}</p>
          <button type="button" onClick={state.retry}>Повторить загрузку списка</button></>}
        {state.status === 'ready' && <>
          <p className="document-list-note" role="status">Показано заявок: {filteredRequests.length}</p>
          {!filteredRequests.length && <EmptyState icon="document" title={requests.length ? 'Нет заявок с этим статусом' : 'Заявок пока нет'}>
            {requests.length ? 'Выберите другой статус или обновите список.' : 'Здесь появятся заявки, отправленные студентами.'}
          </EmptyState>}
          <ul className="document-request-list staff-request-list">
            {filteredRequests.map((request) => <li key={request.id}>
              <button type="button" className="document-request-card" aria-haspopup="dialog" onClick={(event) => {
                opener.current = event.currentTarget; setSelectedId(request.id);
              }}>
                <span className="document-request-top"><span className="document-request-number">Заявка № {request.id}</span>
                  <span className="document-status" data-status={request.status}>{requestStatusLabel(request.status)}</span></span>
                <span className="document-request-name">{request.student.fullName}</span>
                <span>{request.documentType.name}</span>
                <span className="document-request-date">Подана <time dateTime={request.createdAt}>{formatRequestDate(request.createdAt)}</time></span>
                <span className="document-details-hint">Посмотреть подробности</span>
              </button>
            </li>)}
          </ul>
        </>}
      </section>
    </main>
    <footer className="staff-footer"><span className="concept-label">Конкурсный прототип</span>
      <p>Демонстрационные профили. Все персональные данные вымышлены.</p></footer>
    {selectedId !== null && <DocumentRequestDetails key={selectedId} requestId={selectedId} staff
      onClose={onClose} onSessionExpired={onSessionExpired} onUpdated={onUpdated} />}
  </div>;
}
