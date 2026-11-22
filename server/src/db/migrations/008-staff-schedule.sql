-- Существующие занятия и уведомления сохраняются. Меняется только обработка событий.
CREATE TRIGGER schedule_create_notification AFTER INSERT ON schedule_lessons
WHEN NEW.is_demo = 0
BEGIN
  INSERT INTO notifications (group_name, kind, title, body, important, lesson_id, event_at)
  VALUES (NEW.group_name, 'schedule', 'Добавлено занятие',
    NEW.subject || ' · ' || NEW.group_name || '. ' || NEW.lesson_date || ', ' ||
    NEW.start_time || '–' || NEW.end_time || ', ' || NEW.room || '. ' ||
    NEW.teacher || ' · ' || NEW.lesson_type || '.',
    1, NEW.id, NEW.lesson_date || 'T' || NEW.start_time || ':00+03:00');
END;

DROP TRIGGER schedule_change_notification;
CREATE TRIGGER schedule_change_notification AFTER UPDATE ON schedule_lessons
WHEN NEW.status IS NOT OLD.status OR NEW.lesson_date IS NOT OLD.lesson_date OR
  NEW.start_time IS NOT OLD.start_time OR NEW.end_time IS NOT OLD.end_time OR
  NEW.room IS NOT OLD.room OR NEW.teacher IS NOT OLD.teacher OR
  NEW.subject IS NOT OLD.subject OR NEW.lesson_type IS NOT OLD.lesson_type OR
  NEW.change_note IS NOT OLD.change_note OR NEW.group_name IS NOT OLD.group_name
BEGIN
  INSERT INTO notifications (group_name, kind, title, body, important, is_demo, lesson_id, event_at)
  VALUES (NEW.group_name, 'schedule',
    CASE WHEN NEW.status = 'cancelled' THEN 'Занятие отменено'
      WHEN OLD.status = 'cancelled' THEN 'Занятие восстановлено'
      WHEN NEW.lesson_date IS NOT OLD.lesson_date OR NEW.start_time IS NOT OLD.start_time
        OR NEW.end_time IS NOT OLD.end_time THEN 'Занятие перенесено'
      ELSE 'Изменение занятия' END,
    NEW.subject || ' · ' || NEW.group_name || '. ' || NEW.lesson_date || ', ' ||
    NEW.start_time || '–' || NEW.end_time || ', ' || NEW.room || '. ' ||
    NEW.teacher || ' · ' || NEW.lesson_type || '. ' || coalesce(NEW.change_note, ''),
    1, NEW.is_demo, NEW.id, NEW.lesson_date || 'T' || NEW.start_time || ':00+03:00');
END;
