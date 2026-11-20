CREATE TABLE disciplines (
  id INTEGER PRIMARY KEY,
  demo_key TEXT UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE student_disciplines (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  discipline_id INTEGER NOT NULL REFERENCES disciplines(id),
  period TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  UNIQUE (student_id, discipline_id, period)
);

CREATE TABLE current_results (
  id INTEGER PRIMARY KEY,
  student_discipline_id INTEGER NOT NULL REFERENCES student_disciplines(id),
  control_type TEXT NOT NULL,
  points REAL,
  max_points REAL NOT NULL CHECK (max_points > 0),
  scale_rules TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'pending')),
  CHECK (points IS NULL OR (points >= 0 AND points <= max_points)),
  CHECK ((status = 'published' AND points IS NOT NULL) OR (status = 'pending' AND points IS NULL))
);
CREATE INDEX current_results_discipline ON current_results(student_discipline_id);

CREATE TABLE attestations (
  id INTEGER PRIMARY KEY,
  student_discipline_id INTEGER NOT NULL REFERENCES student_disciplines(id),
  type TEXT NOT NULL CHECK (type IN ('exam', 'credit')),
  result TEXT,
  grading_rules TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('published', 'pending')),
  CHECK ((status = 'pending' AND result IS NULL) OR
    (status = 'published' AND result IS NOT NULL AND
      ((type = 'exam' AND result IN ('2', '3', '4', '5')) OR
       (type = 'credit' AND result IN ('Зачтено', 'Не зачтено')))))
);
CREATE INDEX attestations_discipline ON attestations(student_discipline_id);

CREATE TABLE grades_imports (
  name TEXT PRIMARY KEY,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
