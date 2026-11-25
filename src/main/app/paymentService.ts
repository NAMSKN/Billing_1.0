import type Database from 'better-sqlite3';
import { InvoiceKind, InvoiceStatus, PaymentStatus } from '@shared/domain/enums';
import type Decimal from 'decimal.js';
import type { Invoice } from '@shared/domain/models';
import { Money } from '@shared/domain/money';
import { amountInWords } from '@shared/domain/amountWords';
import type { NumberingConfig } from '@shared/domain/numbering';
import type {
  CompanyRepository,
  InvoiceRepository,
  PaymentRepository,
} from '@shared/domain/repositories';
import {
  AllocationStatus,
  PaymentMode,
  VoucherDirection,
  allocatedTotal,
  type Payment,
  type PaymentAllocation,
  type PaymentSnapshot,
  type VoucherParty,
} from '@shared/domain/payment';
import { isCustomerType, isVendorType, type Party, type PartyAddress } from '@shared/domain/party';
import { emptyAddress, type Address } from '@shared/domain/models';
import type { PartyRepository } from '../db/partyRepository';
import { withImmediateTransaction } from './unitOfWork';
import { NumberingService } from './numberingService';
import { SettingsService } from './settingsService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

/** Distinct numbering prefixes per voucher direction on the shared sequence. */
const VOUCHER_PREFIX: Record<VoucherDirection, string> = {
  RECEIPT: 'RCPT',
  PAYMENT: 'PAY',
};

/** Invoice kinds a RECEIPT (customer money-in) may be allocated against. */
const RECEIPT_INVOICE_KINDS: InvoiceKind[] = [
  InvoiceKind.SALES,
  InvoiceKind.JOB_WORK,
  InvoiceKind.CUSTOM,
];
/** Invoice kinds a PAYMENT (vendor money-out) may be allocated against. */
const PAYMENT_INVOICE_KINDS: InvoiceKind[] = [InvoiceKind.PURCHASE];

export class PaymentServiceError extends Error {}
export class PaymentTransitionError extends PaymentServiceError {}
export class PaymentFinalizeError extends PaymentServiceError {
  constructor(
    message: string,
    public readonly issues?: string[],
  ) {
    super(message);
  }
}
export class AllocationError extends PaymentServiceError {}

export interface PaymentDraftInput {
  direction: VoucherDirection;
  party_id: string | null;
  payment_date: string;
  amount: string;
  mode: PaymentMode;
  reference_no: string;
  remarks: string;
}

export interface FinalizeArgs {
  paymentDate: Date;
}

/** A candidate invoice a voucher can be allocated to, with its outstanding. */
export interface AllocatableInvoice {
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  grand_total: string;
  outstanding: string;
  payment_status: PaymentStatus;
}

/** A requested allocation line (created as DRAFT until explicitly confirmed). */
export interface AllocationInput {
  invoice_id: string;
  amount: string;
}

function toDocumentAddress(address: PartyAddress): Address {
  const parts = [
    address.address1.trim(),
    address.address2.trim(),
    address.landmark.trim(),
    address.city.trim(),
    address.pincode.trim(),
  ].filter(Boolean);
  return {
    line: parts.join(', '),
    state_name: address.state,
    state_code: address.state_code,
    godown: '',
  };
}

function partyToVoucherParty(party: Party): VoucherParty {
  return {
    party_id: party.id,
    name: party.company_name,
    gstin: party.gstin,
    pan: party.pan,
    phone: party.contact_no,
    address: toDocumentAddress(party.billing_address),
  };
}

/**
 * Receipt / Payment voucher use cases (DECISIONS D-032). Standalone vouchers
 * that may be allocated across one or more invoices; invoice payment_status and
 * outstanding are DERIVED from CONFIRMED allocations only. Allocation requires
 * explicit confirmation; a draft allocation never affects the invoice. All
 * transactions use withImmediateTransaction (D-026); the voucher number is
 * allocated from the shared sequence with a per-direction prefix.
 */
export class PaymentService {
  constructor(
    private readonly db: Database.Database,
    private readonly payments: PaymentRepository,
    private readonly invoices: InvoiceRepository,
    private readonly companies: CompanyRepository,
    private readonly parties: PartyRepository,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  get(id: string): Payment | null {
    return this.payments.get(id);
  }

  listSummaries(): Payment[] {
    return this.payments.listSummaries();
  }

  private emptyVoucher(direction: VoucherDirection): Payment {
    return {
      id: this.ids(),
      payment_number: null,
      status: InvoiceStatus.DRAFT,
      direction,
      company_id: null,
      party_id: null,
      party: { party_id: null, name: '', gstin: '', pan: '', phone: '', address: emptyAddress() },
      payment_date: this.toIso(this.clock.now()),
      amount: new Money(0),
      mode: PaymentMode.CASH,
      reference_no: '',
      remarks: '',
      allocations: [],
      snapshot: null,
      cancelled_at: '',
      cancel_reason: '',
    };
  }

  createDraft(direction: VoucherDirection): Payment {
    const draft = this.emptyVoucher(direction);
    withImmediateTransaction(this.db, () => this.payments.save(draft));
    return draft;
  }

  /** Save editable fields onto an existing DRAFT voucher. */
  saveDraft(id: string, input: PaymentDraftInput): Payment {
    const draft = this.payments.get(id);
    if (draft === null) throw new PaymentServiceError('voucher not found');
    if (draft.status !== InvoiceStatus.DRAFT) {
      throw new PaymentTransitionError('only a DRAFT voucher can be edited');
    }
    const party = input.party_id ? this.parties.get(input.party_id) : null;
    const updated: Payment = {
      ...draft,
      direction: input.direction,
      party_id: input.party_id,
      party: party ? partyToVoucherParty(party) : draft.party,
      payment_date: input.payment_date,
      amount: new Money(input.amount || '0'),
      mode: input.mode,
      reference_no: input.reference_no.trim(),
      remarks: input.remarks.trim(),
    };
    withImmediateTransaction(this.db, () => this.payments.save(updated));
    return updated;
  }

  /**
   * Finalize a DRAFT voucher: validate, allocate the number, pin the snapshot,
   * persist — all atomically. Confirmed allocations already on the voucher then
   * re-derive the affected invoices' payment_status inside the same transaction.
   */
  finalize(id: string, args: FinalizeArgs): Payment {
    const draft = this.payments.get(id);
    if (draft === null) throw new PaymentFinalizeError('voucher not found');
    if (draft.status !== InvoiceStatus.DRAFT) {
      throw new PaymentTransitionError(`cannot finalize a voucher in status ${draft.status}`);
    }

    const company = this.companies.getActive();
    if (company === null) throw new PaymentFinalizeError('no active company is configured');

    const issues = this.validateForFinalize(draft);
    if (issues.length) {
      throw new PaymentFinalizeError('voucher failed finalization validation', issues);
    }

    const config = this.voucherNumberingConfig(draft.direction);

    return withImmediateTransaction(this.db, () => {
      const allocation = this.numbering.allocate(company.id, args.paymentDate, config);
      const snapshot: PaymentSnapshot = {
        company,
        direction: draft.direction,
        party: draft.party,
        payment_date: this.toIso(args.paymentDate),
        amount: draft.amount,
        mode: draft.mode,
        reference_no: draft.reference_no,
        remarks: draft.remarks,
        amount_words: amountInWords(draft.amount),
        allocations: draft.allocations.map((a) => ({
          invoice_number: a.invoice_number,
          amount: a.amount,
        })),
      };
      const finalized: Payment = {
        ...draft,
        status: InvoiceStatus.FINALIZED,
        payment_number: allocation.invoice_number,
        payment_date: this.toIso(args.paymentDate),
        company_id: company.id,
        snapshot,
      };
      this.payments.save(finalized);
      // Any pre-confirmed allocations now take effect on their invoices.
      this.rederiveInvoices(finalized.allocations.map((a) => a.invoice_id));
      return finalized;
    });
  }

  /** Cancel a voucher. Preserves the record and its number; drops the effect of
   * its confirmed allocations by re-deriving the affected invoices. */
  cancel(id: string, reason: string, when?: Date | null): Payment {
    const voucher = this.payments.get(id);
    if (voucher === null) throw new PaymentServiceError('voucher not found');
    if (voucher.status === InvoiceStatus.CANCELLED) {
      throw new PaymentTransitionError('voucher is already cancelled');
    }
    const affected = voucher.allocations.map((a) => a.invoice_id);
    const cancelled: Payment = {
      ...voucher,
      status: InvoiceStatus.CANCELLED,
      // A cancelled voucher's allocations no longer count; mark them DRAFT so
      // the derivation ignores them (only CONFIRMED on a non-cancelled voucher
      // affects an invoice).
      allocations: voucher.allocations.map((a) => ({ ...a, status: AllocationStatus.DRAFT })),
      cancelled_at: this.toIso(when ?? this.clock.now()),
      cancel_reason: reason,
    };
    return withImmediateTransaction(this.db, () => {
      this.payments.save(cancelled);
      this.rederiveInvoices(affected);
      return cancelled;
    });
  }

  deleteDraft(id: string): void {
    withImmediateTransaction(this.db, () => this.payments.deleteDraft(id));
  }

  /**
   * Duplicate a voucher into a NEW DRAFT (D-017 spirit): copies editable content
   * (direction, party, date, amount, mode, reference, remarks) only. It never
   * copies the number, finalized state, snapshot, or allocations — a new
   * voucher must be allocated and confirmed deliberately.
   */
  duplicate(id: string): Payment {
    const source = this.payments.get(id);
    if (source === null) throw new PaymentServiceError('voucher not found');
    const draft: Payment = {
      ...this.emptyVoucher(source.direction),
      id: this.ids(),
      party_id: source.party_id,
      party: source.party,
      payment_date: this.toIso(this.clock.now()),
      amount: source.amount,
      mode: source.mode,
      reference_no: source.reference_no,
      remarks: source.remarks,
    };
    withImmediateTransaction(this.db, () => this.payments.save(draft));
    return draft;
  }

  // --- Allocation ---

  /**
   * Invoices this voucher can be allocated to, each with its live outstanding.
   * RECEIPT -> customer-facing kinds; PAYMENT -> purchase invoices. Only
   * finalized, non-cancelled invoices with a remaining balance are returned.
   */
  allocatableInvoices(voucherId: string): AllocatableInvoice[] {
    const voucher = this.payments.get(voucherId);
    if (voucher === null) throw new PaymentServiceError('voucher not found');
    const kinds =
      voucher.direction === VoucherDirection.RECEIPT
        ? RECEIPT_INVOICE_KINDS
        : PAYMENT_INVOICE_KINDS;

    const out: AllocatableInvoice[] = [];
    for (const summary of this.invoices.listSummaries()) {
      if (summary.status !== InvoiceStatus.FINALIZED) continue;
      const full = this.invoices.get(summary.id);
      if (!full || !full.snapshot || full.totals === null) continue;
      if (!kinds.includes(full.kind)) continue;
      // If a party is set on the voucher, only that party's invoices.
      if (voucher.party_id && !this.invoiceMatchesParty(full, voucher.party_id)) continue;

      const grand = full.totals.grand_total;
      const outstanding = grand.minus(this.confirmedPaidForInvoice(full.id));
      if (outstanding.lessThanOrEqualTo(new Money(0))) continue;
      out.push({
        invoice_id: full.id,
        invoice_number: full.invoice_number ?? '',
        invoice_date: full.invoice_date,
        grand_total: grand.toFixed(2),
        outstanding: outstanding.toFixed(2),
        payment_status: full.payment_status,
      });
    }
    return out;
  }

  /**
   * Replace a voucher's allocations with DRAFT allocations (does NOT affect any
   * invoice until confirmed). Validates the total does not exceed the voucher
   * amount and that each invoice is a valid candidate.
   */
  setDraftAllocations(voucherId: string, inputs: AllocationInput[]): Payment {
    const voucher = this.payments.get(voucherId);
    if (voucher === null) throw new AllocationError('voucher not found');
    if (voucher.status === InvoiceStatus.CANCELLED) {
      throw new AllocationError('cannot allocate a cancelled voucher');
    }

    const allocations = this.buildAllocations(voucher, inputs, AllocationStatus.DRAFT);
    const updated: Payment = { ...voucher, allocations };
    withImmediateTransaction(this.db, () => this.payments.save(updated));
    return updated;
  }

  /**
   * Explicitly CONFIRM a set of allocations for a voucher (the user action that
   * makes them count). Re-derives every affected invoice's payment_status and
   * outstanding within the same transaction. This is the only path that lets a
   * voucher affect an invoice.
   */
  confirmAllocations(voucherId: string, inputs: AllocationInput[]): Payment {
    const voucher = this.payments.get(voucherId);
    if (voucher === null) throw new AllocationError('voucher not found');
    if (voucher.status === InvoiceStatus.CANCELLED) {
      throw new AllocationError('cannot allocate a cancelled voucher');
    }

    const allocations = this.buildAllocations(voucher, inputs, AllocationStatus.CONFIRMED);
    const updated: Payment = { ...voucher, allocations };
    return withImmediateTransaction(this.db, () => {
      this.payments.save(updated);
      this.rederiveInvoices(allocations.map((a) => a.invoice_id));
      return updated;
    });
  }

  // --- helpers ---

  private buildAllocations(
    voucher: Payment,
    inputs: AllocationInput[],
    status: AllocationStatus,
  ): PaymentAllocation[] {
    const kinds =
      voucher.direction === VoucherDirection.RECEIPT
        ? RECEIPT_INVOICE_KINDS
        : PAYMENT_INVOICE_KINDS;

    let total = new Money(0);
    const allocations: PaymentAllocation[] = [];
    for (const input of inputs) {
      const amount = new Money(input.amount || '0');
      if (amount.lessThanOrEqualTo(new Money(0))) {
        throw new AllocationError('allocation amount must be positive');
      }
      const invoice = this.invoices.get(input.invoice_id);
      if (!invoice || invoice.status !== InvoiceStatus.FINALIZED || invoice.totals === null) {
        throw new AllocationError('allocation target must be a finalized invoice');
      }
      if (!kinds.includes(invoice.kind)) {
        throw new AllocationError(
          `a ${voucher.direction.toLowerCase()} cannot be allocated to a ${invoice.kind} invoice`,
        );
      }
      // Outstanding excluding this voucher's own currently-confirmed amount.
      const alreadyPaid = this.confirmedPaidForInvoice(invoice.id, voucher.id);
      const outstanding = invoice.totals.grand_total.minus(alreadyPaid);
      if (amount.greaterThan(outstanding)) {
        throw new AllocationError(
          `allocation ${amount.toFixed(2)} exceeds outstanding ${outstanding.toFixed(2)} on invoice ${invoice.invoice_number}`,
        );
      }
      total = total.plus(amount);
      allocations.push({
        id: this.ids(),
        payment_id: voucher.id,
        invoice_id: invoice.id,
        invoice_number: invoice.invoice_number ?? '',
        amount,
        status,
      });
    }
    if (total.greaterThan(voucher.amount)) {
      throw new AllocationError(
        `total allocation ${total.toFixed(2)} exceeds voucher amount ${voucher.amount.toFixed(2)}`,
      );
    }
    return allocations;
  }

  /**
   * Sum of CONFIRMED allocations against an invoice from all non-cancelled
   * vouchers, optionally excluding one voucher (when re-computing during its own
   * allocation). Reads the persisted allocation rows for accuracy.
   */
  private confirmedPaidForInvoice(invoiceId: string, excludeVoucherId?: string): Decimal {
    const rows = this.payments.confirmedAllocationsForInvoice(invoiceId);
    let sum = new Money(0);
    for (const a of rows) {
      if (excludeVoucherId && a.payment_id === excludeVoucherId) continue;
      sum = sum.plus(a.amount);
    }
    return sum;
  }

  /** Re-derive payment_status for each affected invoice from confirmed paid. */
  private rederiveInvoices(invoiceIds: string[]): void {
    const seen = new Set<string>();
    for (const id of invoiceIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const invoice = this.invoices.get(id);
      if (!invoice || invoice.totals === null) continue;
      const paid = this.confirmedPaidForInvoice(id);
      const grand = invoice.totals.grand_total;
      let status: PaymentStatus;
      if (paid.lessThanOrEqualTo(new Money(0))) status = PaymentStatus.UNPAID;
      else if (paid.greaterThanOrEqualTo(grand)) status = PaymentStatus.PAID;
      else status = PaymentStatus.PARTIAL;
      if (status !== invoice.payment_status) {
        this.invoices.save({ ...invoice, payment_status: status });
      }
    }
  }

  private invoiceMatchesParty(invoice: Invoice, partyId: string): boolean {
    // PURCHASE invoices carry party_id; customer-facing invoices carry customer_id.
    return invoice.party_id === partyId || invoice.customer_id === partyId;
  }

  private validateForFinalize(draft: Payment): string[] {
    const issues: string[] = [];
    if (draft.party_id === null || !draft.party.name.trim()) {
      issues.push('A party (Company Name) is required.');
    } else {
      const party = this.parties.get(draft.party_id);
      if (party === null) {
        issues.push('The selected party no longer exists.');
      } else if (draft.direction === VoucherDirection.RECEIPT && !isCustomerType(party.company_type)) {
        issues.push('A receipt requires a customer party.');
      } else if (draft.direction === VoucherDirection.PAYMENT && !isVendorType(party.company_type)) {
        issues.push('A payment requires a vendor party.');
      }
    }
    if (draft.amount.lessThanOrEqualTo(new Money(0))) {
      issues.push('Amount must be greater than zero.');
    }
    // Confirmed allocations must not exceed the amount (defensive).
    const confirmed = allocatedTotal(draft.allocations, AllocationStatus.CONFIRMED);
    if (confirmed.greaterThan(draft.amount)) {
      issues.push('Confirmed allocations exceed the voucher amount.');
    }
    return issues;
  }

  private voucherNumberingConfig(direction: VoucherDirection): NumberingConfig {
    const base = this.settings.getNumberingConfig();
    return { ...base, prefix: VOUCHER_PREFIX[direction] };
  }

  private toIso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
}
