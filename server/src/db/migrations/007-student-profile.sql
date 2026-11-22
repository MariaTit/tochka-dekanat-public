-- Только добавление полей: ID пользователей и все связанные данные сохраняются.
ALTER TABLE users ADD COLUMN study_program TEXT
  CHECK (study_program IS NULL OR length(trim(study_program)) > 0);
ALTER TABLE users ADD COLUMN course INTEGER
  CHECK (course IS NULL OR (typeof(course) = 'integer' AND course BETWEEN 1 AND 6));

-- Дополняем только известные вымышленные профили. Изменённые факультеты/группы
-- и другие аккаунты не получают произвольные учебные сведения.
UPDATE users SET study_program = '09.03.02 Информационные системы и технологии', course = 2
WHERE login = 'student1' AND student_group = 'ИС-21'
  AND department = 'Институт цифровых технологий'
  AND role_id = (SELECT id FROM roles WHERE name = 'student');

UPDATE users SET study_program = '38.03.01 Экономика', course = 2
WHERE login = 'student2' AND student_group = 'ЭК-22'
  AND department = 'Институт экономики'
  AND role_id = (SELECT id FROM roles WHERE name = 'student');
