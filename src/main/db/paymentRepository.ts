import type Database from 'better-sqlite3';
import type { InvoiceStatus } from '@shared/domain/enums';
import {
  AllocationStatus,
  PaymentMode,
  VoucherDirection,
  type Payment,
  type PaymentAllocation,
} from '@shared/domain/payment';
import type { PaymentRepository } from '@shared/domain/repositories';
import { money, parseUuid, toCanonicalUuid } from './mappers';
import { deserializePaymentSnapshot, serializePaymentSnapshot } from './serialization';

interface PaymentRow {
  id: string;
  company_id: string | null;
  party_id: string | null;
  direction: string;
  status: string;
  payment_number: string | null;
  payment_date: string;
  amount_paise: number;
  mode: string;
  reference_no: string;
  remarks: string;
  party_name: string;
  party_gstin: string;
  party_pan: string;
  party_phone: string;
  party_address_line: string;
  party_state_name: string;
  party_state_code: string;
  party_godown: string;
  snapshot_json: string | null;
  cancelled_at: string;
  cancel_reason: string;
}

interface AllocationRow {
  id: string;
  payment_id: string;
  invoice_id: string;
  invoice_number: string;
  amount_paise: number;
  status: string;
}

function rowToAllocation(row: AllocationRow): PaymentAllocation {
  return {
    id: toCanonicalUuid(row.id),
    payment_id: toCanonicalUuid(row.payment_id),
    invoice_id: toCanonicalUuid(row.invoice_id),
    invoice_number: row.invoice_number,
    amount: money.fromPaise(row.amount_paise),
    status: row.status as AllocationStatus,
  };
}

function rowToPayment(row: PaymentRow, allocations: PaymentAllocation[]): Payment {
  return {
    id: toCanonicalUuid(row.id),
    payment_number: row.payment_number,
    status: row.status as InvoiceStatus,
    direction: row.direction as VoucherDirection,
    company_id: parseUuid(row.company_id),
    party_id: parseUuid(row.party_id),
    party: {
      party_id: parseUuid(row.party_id),
      name: row.party_name,
      gstin: row.party_gstin,
      pan: row.party_pan,
      phone: row.party_phone,
      address: {
        line: row.party_address_line,
        state_name: row.party_state_name,
        state_code: row.party_state_code,
        godown: row.party_godown,
      },
    },
    payment_date: row.payment_date,
    amount: money.fromPaise(row.amount_paise),
    mode: row.mode as PaymentMode,
    reference_no: row.reference_no,
    remarks: row.remarks,
    allocations,
    snapshot: row.snapshot_json ? deserializePaymentSnapshot(row.snapshot_json) : null,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
  };
}

export class SqlitePaymentRepository implements PaymentRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Payment | null {
    const canonical = toCanonicalUuid(id);
    const row = this.db.prepare('SELECT * FROM payments WHERE id = ?').get(canonical) as
      | PaymentRow
      | undefined;
    if (!row) return null;
    const allocs = this.db
      .prepare('SELECT * FROM payment_allocations WHERE payment_id = ?')
      .all(canonical) as AllocationRow[];
    return rowToPayment(row, allocs.map(rowToAllocation));
  }

  /** Headers only, no allocations. */
  listSummaries(): Payment[] {
    const rows = this.db
      .prepare('SELECT * FROM payments ORDER BY created_at DESC, payment_number DESC')
      .all() as PaymentRow[];
    return rows.map((row) => rowToPayment(row, []));
  }

  confirmedAllocationsForInvoice(invoiceId: string): PaymentAllocation[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM payment_allocations WHERE invoice_id = ? AND status = 'CONFIRMED'",
      )
      .all(toCanonicalUuid(invoiceId)) as AllocationRow[];
    return rows.map(rowToAllocation);
  }

  /**
   * Upsert the header then replace all allocation rows wholesale. Caller owns
   * the transaction (D-026); this method does not begin/commit.
   */
  save(payment: Payment): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO payments (
           id, company_id, party_id, direction, status, payment_number, payment_date,
           amount_paise, mode, reference_no, remarks,
           party_name, party_gstin, party_pan, party_phone,
           party_address_line, party_state_name, party_state_code, party_godown,
           snapshot_json, cancelled_at, cancel_reason, created_at, updated_at
         ) VALUES (
           @id, @company_id, @party_id, @direction, @status, @payment_number, @payment_date,
           @amount_paise, @mode, @reference_no, @remarks,
           @party_name, @party_gstin, @party_pan, @party_phone,
           @party_address_line, @party_state_name, @party_state_code, @party_godown,
           @snapshot_json, @cancelled_at, @cancel_reason, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           company_id=@company_id, party_id=@party_id, direction=@direction, status=@status,
           payment_number=@payment_number, payment_date=@payment_date, amount_paise=@amount_paise,
           mode=@mode, reference_no=@reference_no, remarks=@remarks,
           party_name=@party_name, party_gstin=@party_gstin, party_pan=@party_pan,
           party_phone=@party_phone, party_address_line=@party_address_line,
           party_state_name=@party_state_name, party_state_code=@party_state_code,
           party_godown=@party_godown, snapshot_json=@snapshot_json,
           cancelled_at=@cancelled_at, cancel_reason=@cancel_reason, updated_at=@updated_at`,
      )
      .run({
        id: toCanonicalUuid(payment.id),
        company_id: payment.company_id ? toCanonicalUuid(payment.company_id) : null,
        party_id: payment.party_id ? toCanonicalUuid(payment.party_id) : null,
        direction: payment.direction,
        status: payment.status,
        payment_number: payment.payment_number,
        payment_date: payment.payment_date,
        amount_paise: money.toPaise(payment.amount),
        mode: payment.mode,
        reference_no: payment.reference_no,
        remarks: payment.remarks,
        party_name: payment.party.name,
        party_gstin: payment.party.gstin,
        party_pan: payment.party.pan,
        party_phone: payment.party.phone,
        party_address_line: payment.party.address.line,
        party_state_name: payment.party.address.state_name,
        party_state_code: payment.party.address.state_code,
        party_godown: payment.party.address.godown,
        snapshot_json: payment.snapshot ? serializePaymentSnapshot(payment.snapshot) : null,
        cancelled_at: payment.cancelled_at,
        cancel_reason: payment.cancel_reason,
        created_at: now,
        updated_at: now,
      });

    // Replace allocation rows wholesale.
    this.db
      .prepare('DELETE FROM payment_allocations WHERE payment_id = ?')
      .run(toCanonicalUuid(payment.id));
    const insertAlloc = this.db.prepare(
      `INSERT INTO payment_allocations (
         id, payment_id, invoice_id, invoice_number, amount_paise, status
       ) VALUES (@id, @payment_id, @invoice_id, @invoice_number, @amount_paise, @status)`,
    );
    for (const a of payment.allocations) {
      insertAlloc.run({
        id: toCanonicalUuid(a.id),
        payment_id: toCanonicalUuid(payment.id),
        invoice_id: toCanonicalUuid(a.invoice_id),
        invoice_number: a.invoice_number,
        amount_paise: money.toPaise(a.amount),
        status: a.status,
      });
    }
  }

  /** Delete only drafts; FK cascade removes allocations. */
  deleteDraft(id: string): void {
    this.db
      .prepare("DELETE FROM payments WHERE id = ? AND status = 'DRAFT'")
      .run(toCanonicalUuid(id));
  }
}
