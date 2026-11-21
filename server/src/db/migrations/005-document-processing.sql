-- SQLite не позволяет расширить CHECK существующего столбца.
-- Замена таблицы выполняется внутри транзакции мигратора с копированием всех заявок.
CREATE TABLE document_requests_processing (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES users(id),
  document_type_code TEXT NOT NULL REFERENCES document_types(code),
  comment TEXT CHECK (comment IS NULL OR (length(trim(comment)) BETWEEN 1 AND 1000)),
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'in_progress', 'ready', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  rejection_reason TEXT,
  CHECK (
    (status = 'rejected' AND rejection_reason IS NOT NULL
      AND length(trim(rejection_reason)) BETWEEN 1 AND 1000
      AND instr(rejection_reason, char(0)) = 0)
    OR (status <> 'rejected' AND rejection_reason IS NULL)
  )
);

INSERT INTO document_requests_processing (id, student_id, document_type_code, comment, status, created_at)
SELECT id, student_id, document_type_code, comment, status, created_at FROM document_requests;

DROP TABLE document_requests;
ALTER TABLE document_requests_processing RENAME TO document_requests;
CREATE INDEX document_requests_student ON document_requests(student_id, created_at DESC, id DESC);
CREATE INDEX document_requests_created ON document_requests(created_at DESC, id DESC);

CREATE TRIGGER document_requests_initial_status BEFORE INSERT ON document_requests
WHEN NEW.status <> 'submitted'
BEGIN
  SELECT RAISE(ABORT, 'Document request must be submitted first');
END;

CREATE TRIGGER document_requests_status_transition BEFORE UPDATE OF status ON document_requests
WHEN NOT (
  (OLD.status = 'submitted' AND NEW.status IN ('in_progress', 'rejected'))
  OR (OLD.status = 'in_progress' AND NEW.status IN ('ready', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'Invalid document request status transition');
END;
