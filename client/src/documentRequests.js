export const MAX_COMMENT_LENGTH = 1000;

export function formatRequestDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

export function requestStatusLabel(status) {
  switch (status) {
    case 'submitted': return 'Подана';
    case 'in_progress': return 'В работе';
    case 'ready': return 'Готова';
    case 'rejected': return 'Отклонена';
    default: return 'Неизвестный статус';
  }
}
