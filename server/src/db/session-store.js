import session from 'express-session';

// Срок сессии фиксированный: восемь часов с момента входа.
export class SqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT data FROM sessions WHERE sid = ? AND expires_at > ?').get(sid, Date.now());
      callback(null, row ? JSON.parse(row.data) : null);
    } catch (error) { callback(error); }
  }

  set(sid, data, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
      this.db.prepare(`INSERT INTO sessions (sid, user_id, data, expires_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET user_id = excluded.user_id, data = excluded.data, expires_at = excluded.expires_at`)
        .run(sid, data.userId, JSON.stringify(data), data.expiresAt);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) { callback(error); }
  }
}
