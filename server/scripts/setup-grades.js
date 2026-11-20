import { config } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { createDemoGrades } from '../src/services/demo-grades.js';

const db = openDatabase(config.databasePath);
try {
  const count = createDemoGrades(db);
  console.log(count ? `Добавлено ${count} вымышленных результатов для student1 и student2. Это демонстрационные учебные данные.`
    : 'Демооценки уже подготовлены. Существующие результаты не изменены.');
} finally { db.close(); }
