import type Database from 'better-sqlite3';
import { withImmediateTransaction } from './unitOfWork';
import { NumberingService } from './numberingService';
import type { TrustedScope } from '../backup/backupService';

/**
 * Post-restore numbering reconciliation (DECISIONS D-029). Reads the trusted
 * pre-restore high-water state captured at restore time, advances each numbering
 * scope so the next number is at least trusted_high_water + 1, then clears the
 * RECONCILIATION_PENDING flag — unblocking new issuance.
 */
export class ReconciliationService {
  constructor(
    private readonly db: Database.Database,
    private readonly numbering: NumberingService,
  ) {}

  isPending(): boolean {
    const row = this.db
      .prepare('SELECT reconciliation_pending FROM restore_metadata WHERE id = 1')
      .get() as { reconciliation_pending: number } | undefined;
    return row ? row.reconciliation_pending === 1 : false;
  }

  trustedScopes(): TrustedScope[] {
    const row = this.db
      .prepare('SELECT trusted_state_json FROM restore_metadata WHERE id = 1')
      .get() as { trusted_state_json: string } | undefined;
    if (!row) return [];
    return JSON.parse(row.trusted_state_json) as TrustedScope[];
  }

  /**
   * Reconcile every scope and clear the pending flag. Runs in one transaction
   * so either all scopes advance and issuance unblocks, or nothing changes.
   */
  reconcileAll(): void {
    const scopes = this.trustedScopes();
    withImmediateTransaction(this.db, () => {
      for (const s of scopes) {
        this.numbering.reconcileScope(s.company_id, s.financial_year, s.prefix, s.high_water_mark);
      }
      this.db
        .prepare(
          `INSERT INTO restore_metadata (id, reconciliation_pending, trusted_state_json)
           VALUES (1, 0, '[]')
           ON CONFLICT(id) DO UPDATE SET reconciliation_pending = 0, trusted_state_json = '[]'`,
        )
        .run();
    });
  }
}
