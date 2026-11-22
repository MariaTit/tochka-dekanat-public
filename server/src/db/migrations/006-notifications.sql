CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  source_key TEXT UNIQUE,
  recipient_id INTEGER REFERENCES users(id),
  group_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('news', 'deadline', 'schedule', 'document')),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  lesson_id INTEGER REFERENCES schedule_lessons(id),
  document_request_id INTEGER REFERENCES document_requests(id),
  event_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (recipient_id IS NULL OR group_name IS NULL)
);

CREATE TABLE notification_reads (
  notification_id INTEGER NOT NULL REFERENCES notifications(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  read_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (notification_id, student_id)
);

CREATE INDEX notifications_recipient ON notifications(recipient_id, created_at DESC, id DESC);
CREATE INDEX notifications_group ON notifications(group_name, created_at DESC, id DESC);

-- Уведомление и новый статус сохраняются или откатываются вместе, в том числе
-- при изменении через будущий импорт. Старые заявки миграция не меняет.
CREATE TRIGGER document_status_notification AFTER UPDATE OF status ON document_requests
WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO notifications (recipient_id, kind, title, body, important, document_request_id)
  SELECT NEW.student_id, 'document',
    CASE NEW.status WHEN 'in_progress' THEN 'Заявка взята в работу'
      WHEN 'ready' THEN 'Документ готов' WHEN 'rejected' THEN 'Заявка отклонена' END,
    'Заявка № ' || NEW.id || ' · ' || t.name || '. Статус: ' ||
    CASE NEW.status WHEN 'in_progress' THEN 'В работе.' WHEN 'ready' THEN 'Готова.'
      WHEN 'rejected' THEN 'Отклонена. Причина: ' || NEW.rejection_reason END,
    CASE WHEN NEW.status IN ('ready', 'rejected') THEN 1 ELSE 0 END, NEW.id
  FROM document_types t WHERE t.code = NEW.document_type_code;
END;

CREATE TRIGGER schedule_change_notification AFTER UPDATE ON schedule_lessons
WHEN NEW.status IN ('changed', 'moved', 'cancelled') AND (
  NEW.status IS NOT OLD.status OR NEW.lesson_date IS NOT OLD.lesson_date OR
  NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time OR
  NEW.room IS NOT OLD.room OR NEW.teacher IS NOT OLD.teacher OR
  NEW.subject IS NOT OLD.subject OR NEW.change_note IS NOT OLD.change_note OR
  NEW.group_name IS NOT OLD.group_name)
BEGIN
  INSERT INTO notifications (group_name, kind, title, body, important, is_demo, lesson_id, event_at)
  VALUES (NEW.group_name, 'schedule',
    CASE NEW.status WHEN 'cancelled' THEN 'Занятие отменено'
      WHEN 'moved' THEN 'Занятие перенесено' ELSE 'Изменение занятия' END,
    NEW.subject || ' · ' || NEW.group_name || '. ' || NEW.lesson_date || ', ' ||
    NEW.start_time || '–' || NEW.end_time || ', ' || NEW.room || '. ' || NEW.change_note,
    1, NEW.is_demo, NEW.id, NEW.lesson_date || 'T' || NEW.start_time || ':00+03:00');
END;
