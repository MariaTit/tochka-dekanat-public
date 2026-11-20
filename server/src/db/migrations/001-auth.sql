CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name IN ('student', 'staff'))
);
INSERT INTO roles (name) VALUES ('student'), ('staff');

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  student_group TEXT,
  department TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  sid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expiry ON sessions(expires_at);
