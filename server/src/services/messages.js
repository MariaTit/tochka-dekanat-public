function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function getMessageRecipients(db, user) {
  if (user.role === 'student') return db.prepare(`SELECT u.id, u.full_name AS fullName, u.department
    FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'staff' ORDER BY u.full_name, u.id`).all();
  return db.prepare(`SELECT u.id, u.full_name AS fullName, nullif(trim(u.department), '') AS department,
    u.course, nullif(trim(u.student_group), '') AS "group" FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.name = 'student' ORDER BY u.department, u.course, u.student_group, u.full_name, u.id`).all();
}

export function findConversation(db, user, id) {
  return db.prepare(`SELECT c.id, c.student_id AS studentId, c.staff_id AS staffId,
    u.id AS recipientId, u.full_name AS recipientName FROM conversations c
    JOIN users u ON u.id = CASE WHEN c.student_id = ? THEN c.staff_id ELSE c.student_id END
    WHERE c.id = ? AND ${user.role === 'student' ? 'c.student_id' : 'c.staff_id'} = ?`).get(user.id, id, user.id);
}

export function getConversations(db, user) {
  return db.prepare(`SELECT c.id, u.id AS recipientId, u.full_name AS recipientName,
    c.created_at AS createdAt, m.text AS lastText, m.created_at AS lastMessageAt,
    (SELECT count(*) FROM messages unread WHERE unread.conversation_id = c.id
      AND unread.sender_id <> ? AND unread.read_at IS NULL) AS unreadCount
    FROM conversations c JOIN users u ON u.id = CASE WHEN c.student_id = ? THEN c.staff_id ELSE c.student_id END
    LEFT JOIN messages m ON m.id = (SELECT max(id) FROM messages WHERE conversation_id = c.id)
    WHERE ${user.role === 'student' ? 'c.student_id' : 'c.staff_id'} = ?
    ORDER BY coalesce(m.created_at, c.created_at) DESC, coalesce(m.id, 0) DESC, c.id DESC`).all(user.id, user.id, user.id);
}

export function openConversation(db, user, recipientId) {
  return transaction(db, () => {
    const recipient = db.prepare(`SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = ? AND r.name = ?`).get(recipientId, user.role === 'student' ? 'staff' : 'student');
    if (!recipient) return null;
    const studentId = user.role === 'student' ? user.id : recipientId;
    const staffId = user.role === 'staff' ? user.id : recipientId;
    db.prepare('INSERT INTO conversations (student_id, staff_id) VALUES (?, ?) ON CONFLICT DO NOTHING').run(studentId, staffId);
    const { id } = db.prepare('SELECT id FROM conversations WHERE student_id = ? AND staff_id = ?').get(studentId, staffId);
    return findConversation(db, user, id);
  });
}

export function getMessages(db, conversationId) {
  return db.prepare(`SELECT m.id, m.sender_id AS senderId, u.full_name AS senderName,
    r.name AS senderRole, m.text, m.created_at AS createdAt, m.read_at AS readAt
    FROM messages m JOIN users u ON u.id = m.sender_id JOIN roles r ON r.id = u.role_id
    WHERE m.conversation_id = ? ORDER BY m.id`).all(conversationId);
}

export function sendMessage(db, user, conversationId, text, clientMessageId) {
  return transaction(db, () => {
    if (!findConversation(db, user, conversationId)) return { outcome: 'not_found' };
    const previous = db.prepare('SELECT * FROM messages WHERE sender_id = ? AND client_message_id = ?').get(user.id, clientMessageId);
    if (previous) return previous.conversation_id === conversationId && previous.text === text
      ? { outcome: 'saved', messageId: previous.id } : { outcome: 'conflict' };
    const result = db.prepare('INSERT INTO messages (conversation_id, sender_id, text, client_message_id) VALUES (?, ?, ?, ?)')
      .run(conversationId, user.id, text, clientMessageId);
    return { outcome: 'saved', messageId: Number(result.lastInsertRowid) };
  });
}

export function readConversation(db, user, conversationId, throughMessageId) {
  return transaction(db, () => {
    if (!findConversation(db, user, conversationId)) return false;
    if (!db.prepare('SELECT 1 FROM messages WHERE id = ? AND conversation_id = ?').get(throughMessageId, conversationId)) return false;
    db.prepare(`UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE conversation_id = ? AND id <= ? AND sender_id <> ? AND read_at IS NULL`).run(conversationId, throughMessageId, user.id);
    if (user.role === 'student') db.prepare(`INSERT INTO notification_reads (notification_id, student_id)
      SELECT n.id, ? FROM notifications n JOIN messages m ON n.source_key = 'message:' || m.id
      WHERE m.conversation_id = ? AND m.id <= ? AND n.recipient_id = ?
      ON CONFLICT DO NOTHING`).run(user.id, conversationId, throughMessageId, user.id);
    return true;
  });
}
