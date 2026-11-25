import { describe, it, expect } from 'vitest';
import type { SequenceState } from '@shared/domain/models';
import type { SequenceRepository } from '@shared/domain/repositories';
import { DEFAULT_NUMBERING_CONFIG } from '@shared/domain/numbering';
import {
  NumberingService,
  ReconciliationPendingError,
  type ReconciliationGate,
} from './numberingService';

/** In-memory sequence repo for isolated numbering-service tests. */
class MemSequenceRepo implements SequenceRepository {
  private store = new Map<string, SequenceState>();
  private key(c: string, fy: string, p: string) {
    return `${c}|${fy}|${p}`;
  }
  get(c: string, fy: string, p: string): SequenceState | null {
    return this.store.get(this.key(c, fy, p)) ?? null;
  }
  save(s: SequenceState): void {
    this.store.set(this.key(s.company_id, s.financial_year, s.prefix), s);
  }
}

const COMPANY = '00000000-0000-4000-8000-000000000001';

describe('NumberingService', () => {
  it('allocates from start_value and advances the sequence', () => {
    const repo = new MemSequenceRepo();
    const svc = new NumberingService(repo);
    const a = svc.allocate(COMPANY, new Date(2026, 5, 1), DEFAULT_NUMBERING_CONFIG);
    const b = svc.allocate(COMPANY, new Date(2026, 5, 1), DEFAULT_NUMBERING_CONFIG);
    expect(a.invoice_number).toBe('SE/26-27/001');
    expect(b.invoice_number).toBe('SE/26-27/002');
    expect(repo.get(COMPANY, '26-27', 'SE')!.high_water_mark).toBe(2);
  });

  it('blocks issuance while reconciliation is pending', () => {
    const repo = new MemSequenceRepo();
    const gate: ReconciliationGate = { isReconciliationPending: () => true };
    const svc = new NumberingService(repo, gate);
    expect(() =>
      svc.allocate(COMPANY, new Date(2026, 5, 1), DEFAULT_NUMBERING_CONFIG),
    ).toThrow(ReconciliationPendingError);
  });

  it('reconcileScope advances monotonically past the trusted high-water', () => {
    const repo = new MemSequenceRepo();
    const svc = new NumberingService(repo);
    // No existing scope; reconcile to trusted 50.
    const s = svc.reconcileScope(COMPANY, '26-27', 'SE', 50);
    expect(s.next_sequence).toBe(51);
    expect(s.high_water_mark).toBe(50);
    // A lower trusted value never rolls it back.
    const s2 = svc.reconcileScope(COMPANY, '26-27', 'SE', 10);
    expect(s2.next_sequence).toBe(51);
    expect(s2.high_water_mark).toBe(50);
  });
});
