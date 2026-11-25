import type Database from 'better-sqlite3';
import {
  InvoiceKind,
  InvoiceStatus,
  LineItemType,
  PaymentStatus,
  TaxTreatment,
} from '@shared/domain/enums';
import { emptyReferences } from '@shared/domain/models';
import type { Invoice, InvoiceLine, InvoiceTotals } from '@shared/domain/models';
import type { InvoiceRepository } from '@shared/domain/repositories';
import { money, percent, quantity, parseUuid, toCanonicalUuid } from './mappers';
import {
  deserializeReferences,
  deserializeSnapshot,
  serializeReferences,
  serializeSnapshot,
} from './serialization';

interface InvoiceRow {
  id: string;
  kind: string;
  company_id: string | null;
  customer_id: string | null;
  party_id: string | null;
  status: string;
  payment_status: string;
  invoice_number: string | null;
  invoice_date: string;
  place_of_supply_state: string;
  place_of_supply_code: string;
  template_version: number | null;
  logo_asset_id: string | null;
  signature_asset_id: string | null;
  payment_terms: string;
  payment_mode: string;
  payment_type: string;
  due_date: string;
  notes: string;
  terms: string;
  declaration: string;
  source_document_type: string;
  source_document_number: string;
  source_document_id: string | null;
  references_json: string;
  total_taxable_paise: number;
  total_cgst_paise: number;
  total_sgst_paise: number;
  total_igst_paise: number;
  raw_total_paise: number;
  round_off_paise: number;
  grand_total_paise: number;
  snapshot_json: string | null;
  cancelled_at: string;
  cancel_reason: string;
  replacement_invoice_id: string | null;
}

interface ItemRow {
  id: string;
  invoice_id: string;
  sequence: number;
  item_type: string;
  product_id: string | null;
  job_or_mould_reference: string;
  component_or_part: string;
  operation: string;
  description: string;
  specification: string;
  hsn_sac: string;
  quantity_millis: number;
  unit: string;
  rate_paise: number;
  discount_hundredths: number;
  tax_treatment: string;
  tax_rate_hundredths: number;
  taxable_paise: number | null;
  cgst_paise: number | null;
  sgst_paise: number | null;
  igst_paise: number | null;
}

function itemRowToLine(row: ItemRow): InvoiceLine {
  return {
    id: toCanonicalUuid(row.id),
    sequence: row.sequence,
    item_type: row.item_type as LineItemType,
    product_id: parseUuid(row.product_id),
    job_or_mould_reference: row.job_or_mould_reference,
    component_or_part: row.component_or_part,
    operation: row.operation,
    description: row.description,
    specification: row.specification,
    hsn_sac: row.hsn_sac,
    quantity: quantity.fromMillis(row.quantity_millis),
    unit: row.unit,
    rate: money.fromPaise(row.rate_paise),
    discount_percent: percent.fromHundredths(row.discount_hundredths),
    tax_treatment: row.tax_treatment as TaxTreatment,
    tax_rate: percent.fromHundredths(row.tax_rate_hundredths),
    taxable_amount: row.taxable_paise === null ? null : money.fromPaise(row.taxable_paise),
    cgst_amount: row.cgst_paise === null ? null : money.fromPaise(row.cgst_paise),
    sgst_amount: row.sgst_paise === null ? null : money.fromPaise(row.sgst_paise),
    igst_amount: row.igst_paise === null ? null : money.fromPaise(row.igst_paise),
  };
}

function rowToInvoice(row: InvoiceRow, lines: InvoiceLine[]): Invoice {
  const hasTotals = row.snapshot_json !== null || row.grand_total_paise !== 0;
  const totals: InvoiceTotals | null = hasTotals
    ? {
        total_taxable: money.fromPaise(row.total_taxable_paise),
        total_cgst: money.fromPaise(row.total_cgst_paise),
        total_sgst: money.fromPaise(row.total_sgst_paise),
        total_igst: money.fromPaise(row.total_igst_paise),
        raw_total: money.fromPaise(row.raw_total_paise),
        round_off: money.fromPaise(row.round_off_paise),
        grand_total: money.fromPaise(row.grand_total_paise),
      }
    : null;

  return {
    id: toCanonicalUuid(row.id),
    kind: row.kind as InvoiceKind,
    invoice_number: row.invoice_number,
    status: row.status as InvoiceStatus,
    payment_status: row.payment_status as PaymentStatus,
    invoice_date: row.invoice_date,
    company_id: parseUuid(row.company_id),
    customer_id: parseUuid(row.customer_id),
    party_id: parseUuid(row.party_id),
    place_of_supply: {
      state_name: row.place_of_supply_state,
      state_code: row.place_of_supply_code,
    },
    references: row.references_json
      ? deserializeReferences(row.references_json)
      : emptyReferences(),
    lines,
    totals,
    payment_terms: row.payment_terms,
    payment_mode: row.payment_mode,
    payment_type: row.payment_type,
    due_date: row.due_date,
    notes: row.notes,
    terms: row.terms,
    declaration: row.declaration,
    source_document_type: row.source_document_type,
    source_document_number: row.source_document_number,
    source_document_id: parseUuid(row.source_document_id),
    template_version: row.template_version,
    snapshot: row.snapshot_json ? deserializeSnapshot(row.snapshot_json) : null,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    replacement_invoice_id: parseUuid(row.replacement_invoice_id),
  };
}

export class SqliteInvoiceRepository implements InvoiceRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Invoice | null {
    const canonical = toCanonicalUuid(id);
    const row = this.db.prepare('SELECT * FROM invoices WHERE id = ?').get(canonical) as
      | InvoiceRow
      | undefined;
    if (!row) return null;
    const items = this.db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sequence')
      .all(canonical) as ItemRow[];
    return rowToInvoice(row, items.map(itemRowToLine));
  }

  /** Headers only, no line items (Req 21.3). place_of_supply defaults empty. */
  listSummaries(): Invoice[] {
    const rows = this.db
      .prepare('SELECT * FROM invoices ORDER BY created_at DESC, invoice_number DESC')
      .all() as InvoiceRow[];
    return rows.map((row) => rowToInvoice(row, []));
  }

  /**
   * Upsert the header via ON CONFLICT(id) (NOT INSERT OR REPLACE — so a unique
   * invoice_number collision on a DIFFERENT row raises rather than clobbering),
   * then replace all line rows wholesale. Caller owns the transaction
   * (DECISIONS D-026); this method does not begin/commit its own.
   */
  save(invoice: Invoice): void {
    const now = new Date().toISOString();
    const t = invoice.totals;
    this.db
      .prepare(
        `INSERT INTO invoices (
           id, kind, company_id, customer_id, party_id, status, payment_status, invoice_number,
           invoice_date, place_of_supply_state, place_of_supply_code, template_version,
           logo_asset_id, signature_asset_id, payment_terms, payment_mode, payment_type,
           due_date, notes, terms, declaration,
           source_document_type, source_document_number, source_document_id, references_json,
           total_taxable_paise, total_cgst_paise, total_sgst_paise, total_igst_paise,
           raw_total_paise, round_off_paise, grand_total_paise, snapshot_json,
           cancelled_at, cancel_reason, replacement_invoice_id, created_at, updated_at
         ) VALUES (
           @id, @kind, @company_id, @customer_id, @party_id, @status, @payment_status, @invoice_number,
           @invoice_date, @pos_state, @pos_code, @template_version,
           @logo_asset_id, @signature_asset_id, @payment_terms, @payment_mode, @payment_type,
           @due_date, @notes, @terms, @declaration,
           @source_document_type, @source_document_number, @source_document_id, @references_json,
           @total_taxable_paise, @total_cgst_paise, @total_sgst_paise, @total_igst_paise,
           @raw_total_paise, @round_off_paise, @grand_total_paise, @snapshot_json,
           @cancelled_at, @cancel_reason, @replacement_invoice_id, @created_at, @updated_at
         )
         ON CONFLICT(id) DO UPDATE SET
           kind=@kind, company_id=@company_id, customer_id=@customer_id, party_id=@party_id,
           status=@status, payment_status=@payment_status, invoice_number=@invoice_number,
           invoice_date=@invoice_date, place_of_supply_state=@pos_state,
           place_of_supply_code=@pos_code, template_version=@template_version,
           logo_asset_id=@logo_asset_id, signature_asset_id=@signature_asset_id,
           payment_terms=@payment_terms, payment_mode=@payment_mode, payment_type=@payment_type,
           due_date=@due_date, notes=@notes, terms=@terms,
           declaration=@declaration,
           source_document_type=@source_document_type,
           source_document_number=@source_document_number,
           source_document_id=@source_document_id, references_json=@references_json,
           total_taxable_paise=@total_taxable_paise, total_cgst_paise=@total_cgst_paise,
           total_sgst_paise=@total_sgst_paise, total_igst_paise=@total_igst_paise,
           raw_total_paise=@raw_total_paise, round_off_paise=@round_off_paise,
           grand_total_paise=@grand_total_paise, snapshot_json=@snapshot_json,
           cancelled_at=@cancelled_at, cancel_reason=@cancel_reason,
           replacement_invoice_id=@replacement_invoice_id, updated_at=@updated_at`,
      )
      .run({
        id: toCanonicalUuid(invoice.id),
        kind: invoice.kind,
        company_id: invoice.company_id ? toCanonicalUuid(invoice.company_id) : null,
        customer_id: invoice.customer_id ? toCanonicalUuid(invoice.customer_id) : null,
        party_id: invoice.party_id ? toCanonicalUuid(invoice.party_id) : null,
        status: invoice.status,
        payment_status: invoice.payment_status,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        pos_state: invoice.place_of_supply.state_name,
        pos_code: invoice.place_of_supply.state_code,
        template_version: invoice.template_version,
        logo_asset_id: invoice.snapshot?.logo_asset_id
          ? toCanonicalUuid(invoice.snapshot.logo_asset_id)
          : null,
        signature_asset_id: invoice.snapshot?.signature_asset_id
          ? toCanonicalUuid(invoice.snapshot.signature_asset_id)
          : null,
        payment_terms: invoice.payment_terms,
        payment_mode: invoice.payment_mode,
        payment_type: invoice.payment_type,
        due_date: invoice.due_date,
        notes: invoice.notes,
        terms: invoice.terms,
        declaration: invoice.declaration,
        source_document_type: invoice.source_document_type,
        source_document_number: invoice.source_document_number,
        source_document_id: invoice.source_document_id
          ? toCanonicalUuid(invoice.source_document_id)
          : null,
        references_json: serializeReferences(invoice.references),
        total_taxable_paise: t ? money.toPaise(t.total_taxable) : 0,
        total_cgst_paise: t ? money.toPaise(t.total_cgst) : 0,
        total_sgst_paise: t ? money.toPaise(t.total_sgst) : 0,
        total_igst_paise: t ? money.toPaise(t.total_igst) : 0,
        raw_total_paise: t ? money.toPaise(t.raw_total) : 0,
        round_off_paise: t ? money.toPaise(t.round_off) : 0,
        grand_total_paise: t ? money.toPaise(t.grand_total) : 0,
        snapshot_json: invoice.snapshot ? serializeSnapshot(invoice.snapshot) : null,
        cancelled_at: invoice.cancelled_at,
        cancel_reason: invoice.cancel_reason,
        replacement_invoice_id: invoice.replacement_invoice_id
          ? toCanonicalUuid(invoice.replacement_invoice_id)
          : null,
        created_at: now,
        updated_at: now,
      });

    // Replace line rows wholesale.
    this.db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(toCanonicalUuid(invoice.id));
    const insertItem = this.db.prepare(
      `INSERT INTO invoice_items (
         id, invoice_id, sequence, item_type, product_id, job_or_mould_reference,
         component_or_part, operation,
         description, specification, hsn_sac, quantity_millis, unit, rate_paise,
         discount_hundredths, tax_treatment, tax_rate_hundredths,
         taxable_paise, cgst_paise, sgst_paise, igst_paise
       ) VALUES (
         @id, @invoice_id, @sequence, @item_type, @product_id, @job, @component, @operation,
         @description, @specification, @hsn_sac, @quantity_millis, @unit, @rate_paise,
         @discount_hundredths, @tax_treatment, @tax_rate_hundredths,
         @taxable_paise, @cgst_paise, @sgst_paise, @igst_paise
       )`,
    );
    for (const line of invoice.lines) {
      insertItem.run({
        id: toCanonicalUuid(line.id),
        invoice_id: toCanonicalUuid(invoice.id),
        sequence: line.sequence,
        item_type: line.item_type,
        product_id: line.product_id ? toCanonicalUuid(line.product_id) : null,
        job: line.job_or_mould_reference,
        component: line.component_or_part,
        operation: line.operation,
        description: line.description,
        specification: line.specification,
        hsn_sac: line.hsn_sac,
        quantity_millis: quantity.toMillis(line.quantity),
        unit: line.unit,
        rate_paise: money.toPaise(line.rate),
        discount_hundredths: percent.toHundredths(line.discount_percent),
        tax_treatment: line.tax_treatment,
        tax_rate_hundredths: percent.toHundredths(line.tax_rate),
        taxable_paise: line.taxable_amount === null ? null : money.toPaise(line.taxable_amount),
        cgst_paise: line.cgst_amount === null ? null : money.toPaise(line.cgst_amount),
        sgst_paise: line.sgst_amount === null ? null : money.toPaise(line.sgst_amount),
        igst_paise: line.igst_amount === null ? null : money.toPaise(line.igst_amount),
      });
    }
  }

  /** Delete only drafts; FK cascade removes line items (Req 23.5/42). */
  deleteDraft(id: string): void {
    this.db
      .prepare("DELETE FROM invoices WHERE id = ? AND status = 'DRAFT'")
      .run(toCanonicalUuid(id));
  }
}
