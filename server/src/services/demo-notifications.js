// Фиксированные вымышленные события конкурсной демонстрации ноября 2026 года.
// Каждый источник имеет свой ключ: повтор не меняет сообщения и отметки прочтения.
export function createDemoNotifications(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare(`INSERT INTO notifications
      (source_key, recipient_id, group_name, kind, title, body, important, is_demo,
       lesson_id, document_request_id, event_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING`);
    let count = 0;
    const add = (key, recipient, group, kind, title, body, important = 0, lesson = null, document = null, event = null) => {
      count += Number(insert.run(key, recipient, group, kind, title, body, important, lesson, document, event).changes);
    };
    const students = ['student1', 'student2'].map((login) => db.prepare(`SELECT u.id, u.student_group AS studentGroup
      FROM users u JOIN roles r ON r.id = u.role_id WHERE u.login = ? AND r.name = 'student'`).get(login));
    if (students.some((student) => !student)) throw new Error('Сначала подготовьте оба демонстрационных аккаунта.');
    add('demo-notifications-v1-news', null, null, 'news', 'Новости учебного офиса',
      'В демонстрационном учебном офисе открылась неделя консультаций по учебным вопросам. Объявление для всех студентов.');
    add('demo-notifications-v1-office', null, null, 'news', 'Изменение часов приёма учебного офиса',
      '26 ноября 2026 года демонстрационный учебный офис принимает студентов с 10:00 до 15:00 по московскому времени.',
      1, null, null, '2026-11-26T10:00:00+03:00');
    for (const student of students) {
      const pending = db.prepare(`SELECT d.name FROM student_disciplines s
        JOIN disciplines d ON d.id = s.discipline_id JOIN current_results c ON c.student_discipline_id = s.id
        WHERE s.student_id = ? AND c.status = 'pending' ORDER BY s.id LIMIT 1`).get(student.id);
      add(`demo-notifications-v1-deadline-${student.id}`, student.id, null, 'deadline', 'Напоминание об учебном дедлайне',
        pending ? `Демонстрационный срок сдачи работы по дисциплине «${pending.name}» — 26 ноября 2026 года, 18:00 (Москва). Это вымышленный срок для конкурсного показа; результаты работы не изменены.`
          : 'Демонстрационный срок выбора темы учебного проекта — 26 ноября 2026 года, 18:00 (Москва). Вымышленная учебная дата для конкурсного показа.',
        1, null, null, '2026-11-26T18:00:00+03:00');
      const request = db.prepare(`SELECT r.id, r.status, r.rejection_reason, t.name FROM document_requests r
        JOIN document_types t ON t.code = r.document_type_code WHERE r.student_id = ? ORDER BY r.id DESC LIMIT 1`).get(student.id);
      if (request) {
        const labels = { submitted: 'Подана', in_progress: 'В работе', ready: 'Готова', rejected: 'Отклонена' };
        add(`demo-notifications-v1-document-${request.id}`, student.id, null, 'document', 'Статус вашей заявки на документ',
          `Заявка № ${request.id} · ${request.name}. Статус на момент подготовки демонстрации: ${labels[request.status]}.${request.rejection_reason ? ` Причина: ${request.rejection_reason}` : ''}`,
          1, null, request.id);
      }
    }
    for (const group of new Set(students.map((student) => student.studentGroup).filter(Boolean))) {
      const lessons = db.prepare(`SELECT * FROM schedule_lessons
        WHERE group_name = ? AND is_demo = 1 AND status IN ('changed', 'moved', 'cancelled') ORDER BY id`).all(group);
      for (const lesson of lessons) {
        const title = { changed: 'Изменение занятия', moved: 'Занятие перенесено', cancelled: 'Занятие отменено' }[lesson.status];
        add(`demo-notifications-v1-lesson-${lesson.id}`, null, group, 'schedule', title,
          `${lesson.subject} · ${group}. ${lesson.lesson_date}, ${lesson.start_time}–${lesson.end_time}, ${lesson.room}. ${lesson.change_note}`,
          1, lesson.id, null, `${lesson.lesson_date}T${lesson.start_time}:00+03:00`);
      }
    }
    db.exec('COMMIT');
    return count;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
