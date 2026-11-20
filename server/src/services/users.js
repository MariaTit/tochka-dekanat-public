const PUBLIC_COLUMNS = `users.id, users.login, users.full_name AS fullName, users.email,
  users.student_group AS studentGroup, users.department, roles.name AS role`;

export function findUserById(db, id) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users JOIN roles ON users.role_id = roles.id WHERE users.id = ?`).get(id);
}

export function findLogin(db, login) {
  return db.prepare('SELECT id, password_hash AS passwordHash FROM users WHERE login = ?').get(login);
}
