const COLUMNS = `n.id, n.kind, n.title, n.body, n.important, n.is_demo AS isDemo,
  n.lesson_id AS lessonId, n.document_request_id AS documentRequestId,
  n.event_at AS eventAt, n.created_at AS createdAt, r.read_at AS readAt,
  (SELECT m.conversation_id FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = CAST(substr(n.source_key, 9) AS INTEGER)
      AND n.source_key = 'message:' || m.id AND c.student_id = n.recipient_id) AS conversationId`;
const VISIBLE = `(n.recipient_id = ? OR (n.recipient_id IS NULL AND
  (n.group_name IS NULL OR n.group_name = ?)))`;

function toNotification(row) {
  if (row && row.conversationId === null) delete row.conversationId;
  return row ? { ...row, important: Boolean(row.important), isDemo: Boolean(row.isDemo) } : null;
}

export function getNotifications(db, user) {
  return db.prepare(`SELECT ${COLUMNS} FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.student_id = ?
    WHERE ${VISIBLE} ORDER BY n.created_at DESC, n.id DESC`)
    .all(user.id, user.id, user.studentGroup ?? null).map(toNotification);
}

export function markNotificationRead(db, user, id) {
  // Адресат определяется только по проверенной сессии, включая общие объявления.
  db.prepare(`INSERT INTO notification_reads (notification_id, student_id)
    SELECT n.id, ? FROM notifications n WHERE n.id = ? AND ${VISIBLE}
    ON CONFLICT (notification_id, student_id) DO NOTHING`)
    .run(user.id, id, user.id, user.studentGroup ?? null);
  return toNotification(db.prepare(`SELECT ${COLUMNS} FROM notifications n
    LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.student_id = ?
    WHERE n.id = ? AND ${VISIBLE}`).get(user.id, id, user.id, user.studentGroup ?? null));
}
