import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createDemoSchedule } from '../src/services/demo-schedule.js';

const db = openDatabase(config.databasePath);
try {
  const count = createDemoSchedule(db);
  console.log(count ? `Добавлено ${count} демонстрационных занятий для ИС-21 и ЭК-22 (20–28.11.2026).`
    : 'Деморасписание уже подготовлено. Существующие занятия не изменены.');
} finally { db.close(); }
