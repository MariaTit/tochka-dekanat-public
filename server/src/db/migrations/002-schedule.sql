CREATE TABLE schedule_imports (
  name TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE schedule_lessons (
  id INTEGER PRIMARY KEY,
  demo_key TEXT UNIQUE,
  group_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  lesson_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL CHECK (end_time > start_time),
  teacher TEXT NOT NULL,
  room TEXT NOT NULL,
  lesson_type TEXT NOT NULL CHECK (lesson_type IN ('Лекция', 'Практика', 'Лабораторная', 'Семинар')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'changed', 'moved', 'cancelled')),
  original_date TEXT,
  original_start_time TEXT,
  original_end_time TEXT,
  original_room TEXT,
  change_note TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  CHECK (status = 'scheduled' OR (change_note IS NOT NULL AND length(change_note) > 0)),
  CHECK (status <> 'moved' OR (original_date IS NOT NULL AND original_start_time IS NOT NULL AND original_end_time IS NOT NULL))
);

CREATE INDEX schedule_group_date ON schedule_lessons (group_name, lesson_date, start_time);
CREATE INDEX schedule_group_original_date ON schedule_lessons (group_name, original_date);
