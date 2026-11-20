import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { SERVER_ROOT, config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createDemoUsers } from '../src/services/demo-users.js';

const envPath = path.join(SERVER_ROOT, '.env');
if (!existsSync(envPath)) {
  writeFileSync(envPath, `SESSION_SECRET=${randomBytes(48).toString('base64url')}\nNODE_ENV=development\n`, { flag: 'wx', mode: 0o600 });
  console.log('Создан локальный server/.env с секретом сессий. Он исключён из Git.');
} else if (!config.sessionSecret || Buffer.byteLength(config.sessionSecret) < 32) {
  throw new Error('В server/.env отсутствует достаточно длинный SESSION_SECRET. Существующий файл не изменён.');
}

const db = openDatabase(config.databasePath);
try {
  const accounts = await createDemoUsers(db);
  if (!accounts.length) console.log('Демонстрационные аккаунты уже существуют. Их пароли и данные не изменены.');
  for (const account of accounts) {
    console.log(`Логин: ${account.login} | Пароль: ${account.password} | Роль: ${account.role}`);
  }
  if (accounts.length) console.log('Сохраните пароли в менеджере паролей: повторно показать их из базы невозможно.');
} finally { db.close(); }
