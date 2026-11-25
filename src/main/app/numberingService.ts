import type { SequenceState } from '@shared/domain/models';
import type { SequenceRepository } from '@shared/domain/repositories';
import {
  financialYearFor,
  formatFinancialYear,
  formatInvoiceNumber,
  type NumberingConfig,
} from '@shared/domain/numbering';

/**
 * Transactional invoice-number allocation (faithful port of the Python
 * numbering service). Must be called inside the caller's BEGIN IMMEDIATE
 * transaction (DECISIONS D-026/D-028). Uses a dedicated sequence with a
 * high-water mark — never MAX(invoice_number) (D-012).
 *
 * Issuance is blocked while post-restore reconciliation is pending (D-029): a
 * ReconciliationPendingError is raised so no number is reused before the
 * operator confirms reconciliation.
 */

export interface Allocation {
  invoice_number: string;
  sequence: number;
  financial_year_label: string;
}

export class NumberingError extends Error {}
export class ReconciliationPendingError extends NumberingError {}

export interface ReconciliationGate {
  isReconciliationPending(): boolean;
}

const ALWAYS_ALLOW: ReconciliationGate = { isReconciliationPending: () => false };

export class NumberingService {
  constructor(
    private readonly sequences: SequenceRepository,
    private readonly gate: ReconciliationGate = ALWAYS_ALLOW,
  ) {}

  allocate(companyId: string, invoiceDate: Date, config: NumberingConfig): Allocation {
    if (this.gate.isReconciliationPending()) {
      throw new ReconciliationPendingError(
        'numbering reconciliation pending after restore; issuance blocked',
      );
    }

    const fy = financialYearFor(invoiceDate, config.fy_scheme);
    const fyLabel = formatFinancialYear(fy);

    const state = this.sequences.get(companyId, fyLabel, config.prefix);
    const sequence = state ? state.next_sequence : config.start_value;
    const highWater = state ? state.high_water_mark : 0;

    if (sequence < config.start_value) {
      throw new NumberingError(
        `sequence ${sequence} is below the configured start value ${config.start_value}`,
      );
    }

    const updated: SequenceState = {
      company_id: companyId,
      financial_year: fyLabel,
      prefix: config.prefix,
      next_sequence: sequence + 1,
      high_water_mark: Math.max(highWater, sequence),
    };
    this.sequences.save(updated);

    return {
      invoice_number: formatInvoiceNumber(config, fyLabel, sequence),
      sequence,
      financial_year_label: fyLabel,
    };
  }

  /**
   * Advance one numbering scope past the trusted pre-restore high-water mark
   * (DECISIONS D-029). Monotonic: an already-ahead scope is never rolled back.
   * Must run inside the caller's transaction.
   */
  reconcileScope(
    companyId: string,
    financialYearLabel: string,
    prefix: string,
    trustedHighWaterMark: number,
  ): SequenceState {
    const state = this.sequences.get(companyId, financialYearLabel, prefix);
    const currentNext = state ? state.next_sequence : 0;
    const currentHighWater = state ? state.high_water_mark : 0;

    const reconciled: SequenceState = {
      company_id: companyId,
      financial_year: financialYearLabel,
      prefix,
      next_sequence: Math.max(currentNext, trustedHighWaterMark + 1),
      high_water_mark: Math.max(currentHighWater, trustedHighWaterMark),
    };
    this.sequences.save(reconciled);
    return reconciled;
  }
}
