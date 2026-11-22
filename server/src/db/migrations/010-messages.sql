-- Только новые таблицы и триггеры. Прежние данные и уведомления не изменяются.
CREATE TABLE conversations (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  staff_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (student_id, staff_id),
  CHECK (student_id <> staff_id)
);
CREATE INDEX conversations_staff ON conversations(staff_id, id);

CREATE TRIGGER conversation_roles BEFORE INSERT ON conversations
WHEN NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = NEW.student_id AND r.name = 'student')
  OR NOT EXISTS (SELECT 1 FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = NEW.staff_id AND r.name = 'staff')
BEGIN SELECT RAISE(ABORT, 'Invalid conversation participants'); END;

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  client_message_id TEXT NOT NULL,
  text TEXT NOT NULL CHECK (length(trim(text)) BETWEEN 1 AND 4000 AND instr(text, char(0)) = 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  read_at TEXT,
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_history ON messages(conversation_id, id);
CREATE INDEX messages_unread ON messages(conversation_id, sender_id, id) WHERE read_at IS NULL;

CREATE TRIGGER message_participant BEFORE INSERT ON messages
WHEN NOT EXISTS (SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND NEW.sender_id IN (c.student_id, c.staff_id))
BEGIN SELECT RAISE(ABORT, 'Sender is not a participant'); END;

-- Прежняя система персональных уведомлений; уникальный ключ исключает дубли.
CREATE TRIGGER message_notification AFTER INSERT ON messages
WHEN EXISTS (SELECT 1 FROM conversations c WHERE c.id = NEW.conversation_id AND c.staff_id = NEW.sender_id)
BEGIN
  INSERT INTO notifications (source_key, recipient_id, kind, title, body, important)
  SELECT 'message:' || NEW.id, c.student_id, 'news', 'Новое личное сообщение',
    u.full_name || ': ' || NEW.text, 1
  FROM conversations c JOIN users u ON u.id = NEW.sender_id WHERE c.id = NEW.conversation_id;
END;
