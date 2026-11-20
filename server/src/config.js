import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SERVER_ROOT = fileURLToPath(new URL('../', import.meta.url));
const envPath = path.join(SERVER_ROOT, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

export const config = {
  port: Number(process.env.PORT || 3001),
  databasePath: process.env.DATABASE_PATH || path.join(SERVER_ROOT, 'data', 'tochka.sqlite'),
  sessionSecret: process.env.SESSION_SECRET,
  sessionTtlMs: 8 * 60 * 60 * 1000,
  production: process.env.NODE_ENV === 'production',
  trustProxy: process.env.TRUST_PROXY === '1',
  origins: (process.env.APP_ORIGINS || 'http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:3001,http://localhost:3001')
    .split(',').map((origin) => origin.trim()),
};

export function validateConfig() {
  if (!config.sessionSecret || Buffer.byteLength(config.sessionSecret) < 32) {
    throw new Error('Не задан SESSION_SECRET (минимум 32 байта). Выполните npm.cmd --prefix server run setup.');
  }
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error('Некорректный PORT.');
  }
  if (config.production && (!process.env.APP_ORIGINS || config.origins.some((origin) => !origin.startsWith('https://')))) {
    throw new Error('В production укажите APP_ORIGINS с HTTPS-адресом приложения.');
  }
}
