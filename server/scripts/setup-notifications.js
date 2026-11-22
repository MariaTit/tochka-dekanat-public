import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createDemoNotifications } from '../src/services/demo-notifications.js';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const relative = path.relative(projectRoot, path.resolve(config.databasePath));
if (config.production || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('Эта команда предназначена только для локальной базы внутри проекта.');
}
const db = openDatabase(config.databasePath);
try {
  const count = createDemoNotifications(db);
  console.log(`Добавлено демонстрационных уведомлений: ${count}. Существующие данные и отметки прочтения сохранены.`);
} finally { db.close(); }
