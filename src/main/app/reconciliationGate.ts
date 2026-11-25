import type Database from 'better-sqlite3';
import type { ReconciliationGate } from './numberingService';

/**
 * Reads the post-restore reconciliation flag from restore_metadata. While
 * pending, invoice-number issuance is blocked (DECISIONS D-029) until the
 * operator confirms the reconciled high-water mark.
 */
export class MetadataReconciliationGate implements ReconciliationGate {
  constructor(private readonly db: Database.Database) {}

  isReconciliationPending(): boolean {
    const row = this.db
      .prepare('SELECT reconciliation_pending FROM restore_metadata WHERE id = 1')
      .get() as { reconciliation_pending: number } | undefined;
    return row ? row.reconciliation_pending === 1 : false;
  }
}
