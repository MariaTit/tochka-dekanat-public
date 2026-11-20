import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(filename) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const directory = new URL('./migrations/', import.meta.url);
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get(name)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(new URL(name, directory), 'utf8'));
      db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(name);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      db.close();
      throw error;
    }
  }
  return db;
}
