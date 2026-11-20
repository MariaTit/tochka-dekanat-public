import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword } from '../services/passwords.js';
import { findLogin, findUserById } from '../services/users.js';
import { requireAuth } from '../middleware/auth.js';

export async function createAuthRouter(db, config, cookieOptions) {
  const router = Router();
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут.' },
  });

  router.post('/login', loginLimit, async (request, response, next) => {
    const { login, password } = request.body || {};
    if (typeof login !== 'string' || typeof password !== 'string'
      || !/^[a-zA-Z0-9._-]{1,64}$/.test(login.trim()) || password.length < 1 || password.length > 256) {
      return response.status(400).json({ error: 'Введите корректные логин и пароль.' });
    }
    const account = findLogin(db, login.trim());
    const matches = await verifyPassword(password, account?.passwordHash || dummyHash);
    if (!account || !matches) return response.status(401).json({ error: 'Неверный логин или пароль.' });
    request.session.regenerate((error) => {
      if (error) return next(error);
      request.session.userId = account.id;
      request.session.expiresAt = Date.now() + config.sessionTtlMs;
      request.session.save((saveError) => {
        if (saveError) return next(saveError);
        response.json({ user: findUserById(db, account.id) });
      });
    });
  });

  router.get('/me', requireAuth(db), (request, response) => response.json({ user: request.user }));

  router.post('/logout', (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie('tochka.sid', cookieOptions);
      response.status(204).end();
    });
  });

  return router;
}
