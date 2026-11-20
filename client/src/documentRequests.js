export const MAX_COMMENT_LENGTH = 1000;

export function formatRequestDate(value) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Moscow',
  }).format(new Date(value));
}

export function requestStatusLabel(status) {
  return status === 'submitted' ? 'Подана' : 'Неизвестный статус';
}
