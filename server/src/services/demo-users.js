import { generatePassword, hashPassword } from './passwords.js';

const DEMO_USERS = [
  { login: 'student1', role: 'student', fullName: 'Алина Сергеевна Ветрова', email: 'alina.vetrova@example.test', group: 'ИС-21', department: 'Институт цифровых технологий' },
  { login: 'student2', role: 'student', fullName: 'Марк Ильич Озёров', email: 'mark.ozerov@example.test', group: 'ЭК-22', department: 'Институт экономики' },
  { login: 'staff', role: 'staff', fullName: 'Елена Андреевна Ладова', email: 'elena.ladova@example.test', group: null, department: 'Учебный офис' },
];

export async function createDemoUsers(db) {
  const created = [];
  // Повторный запуск не меняет существующие аккаунты и их пароли.
  for (const user of DEMO_USERS) {
    if (db.prepare('SELECT id FROM users WHERE login = ?').get(user.login)) continue;
    const password = generatePassword();
    const hash = await hashPassword(password);
    const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(user.role);
    const result = db.prepare(`INSERT INTO users
      (login, password_hash, role_id, full_name, email, student_group, department) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(user.login, hash, role.id, user.fullName, user.email, user.group, user.department);
    created.push({ id: Number(result.lastInsertRowid), login: user.login, password, role: user.role });
  }
  return created;
}
