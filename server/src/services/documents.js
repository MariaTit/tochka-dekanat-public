const REQUEST_COLUMNS = `r.id, r.student_id AS studentId, r.document_type_code AS documentTypeCode,
  t.name AS documentTypeName, r.comment, r.status, r.created_at AS createdAt`;

function toRequest(row) {
  if (!row) return null;
  const { documentTypeCode, documentTypeName, ...request } = row;
  return { ...request, documentType: { code: documentTypeCode, name: documentTypeName } };
}

export function getDocumentTypes(db) {
  return db.prepare('SELECT code, name FROM document_types ORDER BY code').all();
}

export function getDocumentType(db, code) {
  return db.prepare('SELECT code, name FROM document_types WHERE code = ?').get(code);
}

export function getDocumentRequests(db, studentId) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM document_requests r
    JOIN document_types t ON t.code = r.document_type_code
    WHERE r.student_id = ? ORDER BY r.created_at DESC, r.id DESC`)
    .all(studentId).map(toRequest);
}

export function getDocumentRequest(db, studentId, id) {
  return toRequest(db.prepare(`SELECT ${REQUEST_COLUMNS} FROM document_requests r
    JOIN document_types t ON t.code = r.document_type_code
    WHERE r.student_id = ? AND r.id = ?`).get(studentId, id));
}

export function createDocumentRequest(db, studentId, documentTypeCode, comment) {
  // Владелец передаётся из проверенной сессии, статус и дата задаются базой.
  const result = db.prepare(`INSERT INTO document_requests (student_id, document_type_code, comment)
    VALUES (?, ?, ?)`).run(studentId, documentTypeCode, comment);
  return getDocumentRequest(db, studentId, Number(result.lastInsertRowid));
}
