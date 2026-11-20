CREATE TABLE document_types (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL
);

INSERT INTO document_types (code, name) VALUES
  ('study_certificate', 'Справка об обучении'),
  ('study_period_certificate', 'Справка о периоде обучения');

CREATE TABLE document_requests (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  document_type_code TEXT NOT NULL REFERENCES document_types(code),
  comment TEXT CHECK (comment IS NULL OR (length(trim(comment)) BETWEEN 1 AND 1000)),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status = 'submitted'),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX document_requests_student ON document_requests(student_id, created_at DESC, id DESC);
