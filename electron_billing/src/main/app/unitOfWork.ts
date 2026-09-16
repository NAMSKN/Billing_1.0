import type Database from 'better-sqlite3';

/**
 * Runs `work` inside a single BEGIN IMMEDIATE transaction (DECISIONS D-026/D-028).
 * BEGIN IMMEDIATE takes a reserved write lock up front so two concurrent
 * finalizations cannot obtain the same sequence; the UNIQUE index on
 * invoice_number is the final backstop. Commits on success, rolls back on any
 * thrown error. Repositories and the numbering service participate in this
 * transaction and never begin/commit their own.
 */
export function withImmediateTransaction<T>(db: Database.Database, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors; surface the original.
    }
    throw err;
  }
}
