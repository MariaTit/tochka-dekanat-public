import { findUserById } from '../services/users.js';

export function requireAuth(db) {
  return (request, response, next) => {
    const user = request.session.userId && request.session.expiresAt > Date.now()
      ? findUserById(db, request.session.userId) : null;
    if (!user) return response.status(401).json({ error: 'Войдите в аккаунт. Сессия отсутствует или истекла.' });
    request.user = user;
    next();
  };
}

export function requireRole(role) {
  return (request, response, next) => {
    if (request.user.role !== role) return response.status(403).json({ error: 'Нет доступа к этому кабинету.' });
    next();
  };
}

export function protectMutation(origins) {
  return (request, response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    // Пользовательский заголовок требует CORS preflight у чужого сайта.
    // CORS для чужих сайтов не разрешён. Origin дополнительно проверяется.
    if (request.get('X-Tochka-Request') !== '1'
      || (request.get('Origin') && !origins.includes(request.get('Origin')))
      || request.get('Sec-Fetch-Site') === 'cross-site') {
      return response.status(403).json({ error: 'Запрос отклонён. Обновите страницу приложения.' });
    }
    next();
  };
}
