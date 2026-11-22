import { openDatabase } from '../../src/db/database.js';
import { createDemoUsers } from '../../src/services/demo-users.js';

// Снимок колонок до 007: проверки старых миграций сравнивают прежние данные,
// разрешая добавление новых колонок. Новые поля проверяются в student-profile.test.js.
export const LEGACY_USER_COLUMNS = 'id, login, password_hash, role_id, full_name, email, student_group, department, created_at';

export async function createLegacyDemoUsers(db) {
  const source = openDatabase(':memory:');
  try {
    const accounts = await createDemoUsers(source);
    const insert = db.prepare(`INSERT INTO users (${LEGACY_USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of source.prepare(`SELECT ${LEGACY_USER_COLUMNS} FROM users ORDER BY id`).all()) {
      insert.run(...Object.values(row));
    }
    return accounts;
  } finally {
    source.close();
  }
}
