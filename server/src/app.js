import express from 'express';
import healthRouter from './routes/health.js';
import session from 'express-session';
import { SqliteSessionStore } from './db/session-store.js';
import { createAuthRouter } from './routes/auth.js';
import { protectMutation, requireAuth, requireRole } from './middleware/auth.js';
import { createScheduleRouter } from './routes/schedule.js';

export async function createApp(db, config) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use('/api', (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api/health', healthRouter);
  app.use('/api', protectMutation(config.origins));
  app.use(express.json({ limit: '8kb' }));
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: config.production, path: '/' };
  app.use('/api', session({
    name: 'tochka.sid', secret: config.sessionSecret,
    store: new SqliteSessionStore(db), resave: false, saveUninitialized: false,
    cookie: { ...cookieOptions, maxAge: config.sessionTtlMs },
  }));
  app.use('/api/auth', await createAuthRouter(db, config, cookieOptions));
  app.use('/api/student/schedule', createScheduleRouter(db));
  app.get('/api/student', requireAuth(db), requireRole('student'), (request, response) => response.json({ user: request.user }));
  app.get('/api/staff', requireAuth(db), requireRole('staff'), (request, response) => response.json({ user: request.user }));
  app.get('/api/users/:userId', requireAuth(db), (request, response) => {
    if (request.params.userId !== String(request.user.id)) {
      return response.status(403).json({ error: 'Доступ разрешён только к собственному профилю.' });
    }
    response.json({ user: request.user });
  });

  app.use('/api', (request, response) => {
    response.status(404).json({ error: 'Маршрут API не найден' });
  });
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = error.status === 400 ? 400 : error.status === 413 ? 413 : 500;
    if (status === 500) console.error('Ошибка API:', error.code || error.name);
    response.status(status).json({ error: status === 500 ? 'Ошибка сервера. Попробуйте ещё раз.' : 'Некорректное тело запроса.' });
  });
  return app;
}
