import Database from 'better-sqlite3';
import { applyPending } from './migrations';

/**
 * Opens a SQLite connection and applies pending migrations. Mirrors the Python
 * connection setup: foreign keys ON, WAL journaling for durability, and a busy
 * timeout so a briefly-locked write waits rather than failing.
 *
 * Transactions are owned by the application use cases (DECISIONS D-026); the
 * connection itself does not wrap writes. Finalization uses BEGIN IMMEDIATE
 * via the numbering/invoice service (D-028).
 */
export function connect(databaseFile: string): Database.Database {
  const db = new Database(databaseFile);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  applyPending(db);
  return db;
}

/** Open an in-memory database (for tests). */
export function connectMemory(): Database.Database {
  return connect(':memory:');
}
