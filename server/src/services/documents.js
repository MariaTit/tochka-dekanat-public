const REQUEST_COLUMNS = `r.id, r.student_id AS studentId, r.document_type_code AS documentTypeCode,
  t.name AS documentTypeName, r.comment, r.status, r.created_at AS createdAt,
  r.rejection_reason AS rejectionReason`;

const STATUS_TRANSITIONS = {
  submitted: ['in_progress', 'rejected'],
  in_progress: ['ready', 'rejected'],
  ready: [],
  rejected: [],
};

const STUDENT_COLUMNS = `u.full_name AS studentFullName, u.email AS studentEmail,
  u.student_group AS studentGroup, u.department AS studentDepartment`;

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

function toStaffRequest(row) {
  if (!row) return null;
  const { studentFullName, studentEmail, studentGroup, studentDepartment, ...request } = row;
  return { ...toRequest(request), student: {
    id: row.studentId, fullName: studentFullName, email: studentEmail,
    studentGroup, department: studentDepartment,
  } };
}

export function getStaffDocumentRequests(db) {
  return db.prepare(`SELECT ${REQUEST_COLUMNS}, ${STUDENT_COLUMNS} FROM document_requests r
    JOIN document_types t ON t.code = r.document_type_code
    JOIN users u ON u.id = r.student_id
    ORDER BY r.created_at DESC, r.id DESC`).all().map(toStaffRequest);
}

export function getStaffDocumentRequest(db, id) {
  return toStaffRequest(db.prepare(`SELECT ${REQUEST_COLUMNS}, ${STUDENT_COLUMNS} FROM document_requests r
    JOIN document_types t ON t.code = r.document_type_code
    JOIN users u ON u.id = r.student_id WHERE r.id = ?`).get(id));
}

export function updateDocumentRequestStatus(db, id, status, rejectionReason) {
  // Проверка и запись под одной блокировкой: два сотрудника не перезапишут статус
  // на основании устаревшего состояния заявки.
  db.exec('BEGIN IMMEDIATE');
  try {
    const current = getStaffDocumentRequest(db, id);
    let result;
    if (!current) {
      result = { outcome: 'not_found' };
    } else if (!STATUS_TRANSITIONS[current.status].includes(status)) {
      result = { outcome: 'conflict' };
    } else {
      db.prepare('UPDATE document_requests SET status = ?, rejection_reason = ? WHERE id = ?')
        .run(status, rejectionReason, id);
      result = { outcome: 'updated', request: getStaffDocumentRequest(db, id) };
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
