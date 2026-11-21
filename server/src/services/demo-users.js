import { generatePassword, hashPassword } from './passwords.js';

const DEMO_USERS = [
  { login: 'student1', role: 'student', fullName: 'Алина Сергеевна Ветрова', email: 'alina.vetrova@example.test', group: 'ИС-21', department: 'Институт цифровых технологий' },
  { login: 'student2', role: 'student', fullName: 'Марк Ильич Озёров', email: 'mark.ozerov@example.test', group: 'ЭК-22', department: 'Институт экономики' },
  { login: 'staff', role: 'staff', fullName: 'Елена Андреевна Ладова', email: 'elena.ladova@example.test', group: null, department: 'Учебный офис' },
];

export async function createDemoUsers(db, { passwords } = {}) {
  // Повторный запуск не меняет существующие аккаунты и их пароли.
  const pending = DEMO_USERS.filter((user) => !db.prepare('SELECT id FROM users WHERE login = ?').get(user.login));
  // Сначала проверяем все недостающие пароли, чтобы ошибка настройки не создала часть аккаунтов.
  const accounts = pending.map((user) => {
    const password = passwords === undefined ? generatePassword() : passwords[user.login];
    if (typeof password !== 'string' || password.length < 12 || password.length > 256 || !password.trim()) {
      throw new Error(`Для нового ${user.login} задайте DEMO_${user.login.toUpperCase()}_PASSWORD: от 12 до 256 символов.`);
    }
    return { ...user, password };
  });
  // Хеширование выполняется до блокировки SQLite.
  for (const account of accounts) account.hash = await hashPassword(account.password);
  if (!accounts.length) return [];
  const created = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const user of accounts) {
      const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(user.role);
      const result = db.prepare(`INSERT INTO users
        (login, password_hash, role_id, full_name, email, student_group, department) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(login) DO NOTHING`)
        .run(user.login, user.hash, role.id, user.fullName, user.email, user.group, user.department);
      if (result.changes) created.push({ id: Number(result.lastInsertRowid), login: user.login, password: user.password, role: user.role });
    }
    db.exec('COMMIT');
    return created;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
