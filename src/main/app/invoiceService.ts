import type Database from 'better-sqlite3';
import { InvoiceKind, InvoiceStatus, PaymentStatus, TaxType } from '@shared/domain/enums';
import type {
  Company,
  Customer,
  Invoice,
  InvoiceLine,
  InvoiceSnapshot,
} from '@shared/domain/models';
import type {
  CompanyRepository,
  CustomerRepository,
  InvoiceRepository,
} from '@shared/domain/repositories';
import type { Party, PartyAddress } from '@shared/domain/party';
import type { PartyRepository } from '../db/partyRepository';
import { DEFAULT_NUMBERING_CONFIG, type NumberingConfig } from '@shared/domain/numbering';
import {
  calculateInvoiceTotals,
  calculateLine,
  calculateLineTax,
  buildTaxSummary,
  determineTaxType,
  ensureSupportedTreatment,
  type TaxLineInput,
} from '@shared/domain/calculation';
import { amountInWords } from '@shared/domain/amountWords';
import {
  validateDraft,
  validateForFinalization,
  isOk,
  type ValidationResult,
} from '@shared/domain/validation';
import { withImmediateTransaction } from './unitOfWork';
import { NumberingService } from './numberingService';
import { SettingsService } from './settingsService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

const DEFAULT_TEMPLATE_VERSION = 1;

/** Document-number prefix per invoice kind (shared invoice_sequences table). */
const INVOICE_KIND_PREFIX: Record<InvoiceKind, string> = {
  SALES: 'SE',
  CUSTOM: 'SE',
  JOB_WORK: 'JW',
  PURCHASE: 'PB',
};

export class InvoiceServiceError extends Error {}
export class FinalizationError extends Error {
  constructor(
    message: string,
    public readonly validation?: ValidationResult,
  ) {
    super(message);
  }
}

export interface FinalizeArgs {
  invoiceDate: Date;
  dueDate?: Date | null;
  today?: Date | null;
}

/**
 * Invoice lifecycle use cases (faithful port of the Python InvoiceService).
 * Owns transaction boundaries via withImmediateTransaction (DECISIONS D-026).
 * Ids/clock are injected for deterministic tests.
 */
export class InvoiceService {
  constructor(
    private readonly db: Database.Database,
    private readonly invoices: InvoiceRepository,
    private readonly companies: CompanyRepository,
    private readonly customers: CustomerRepository,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly parties: PartyRepository,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  get(id: string): Invoice | null {
    return this.invoices.get(id);
  }

  listSummaries(): Invoice[] {
    return this.invoices.listSummaries();
  }

  /** Create and persist a new draft with a fresh id, status DRAFT, no number. */
  createDraft(base?: Invoice): Invoice {
    const draft: Invoice = {
      ...(base ?? this.emptyInvoice()),
      id: this.ids(),
      status: InvoiceStatus.DRAFT,
      invoice_number: null,
    };
    withImmediateTransaction(this.db, () => this.invoices.save(draft));
    return draft;
  }

  /** Persist edits to a draft; returns permissive validation warnings. */
  saveDraft(invoice: Invoice): ValidationResult {
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new InvoiceServiceError('save_draft is only valid for DRAFT invoices');
    }
    if (invoice.invoice_number !== null) {
      throw new InvoiceServiceError('a draft must not carry an invoice number');
    }
    const result = validateDraft(invoice);
    withImmediateTransaction(this.db, () => this.invoices.save(invoice));
    return result;
  }

  /** Run the strict finalization validation gate (no allocation/persistence). */
  checkFinalizationReadiness(invoice: Invoice, args: FinalizeArgs): ValidationResult {
    const { company, customer } = this.resolveParties(invoice);
    return validateForFinalization(invoice, {
      company,
      customer,
      invoiceDate: args.invoiceDate,
      dueDate: args.dueDate ?? null,
      today: args.today ?? null,
    });
  }

  /**
   * Finalize a draft atomically within one BEGIN IMMEDIATE transaction.
   * Flow: load draft -> strict validate -> resolve tax type -> calculate
   * lines/tax/totals -> allocate number -> build snapshot -> pin template ->
   * persist -> COMMIT. Any failure rolls back completely.
   */
  finalize(invoiceId: string, args: FinalizeArgs): Invoice {
    const draft = this.invoices.get(invoiceId);
    if (draft === null) throw new FinalizationError('invoice not found');
    if (draft.status !== InvoiceStatus.DRAFT) {
      throw new FinalizationError('only a DRAFT invoice can be finalized');
    }

    const { company, customer } = this.resolveParties(draft);

    const validation = validateForFinalization(draft, {
      company,
      customer,
      invoiceDate: args.invoiceDate,
      dueDate: args.dueDate ?? null,
      today: args.today ?? null,
    });
    if (!isOk(validation)) {
      throw new FinalizationError('invoice failed finalization validation', validation);
    }

    const taxConfig = this.settings.getTaxRateConfig();
    const taxType = determineTaxType(
      company.address.state_code,
      draft.place_of_supply.state_code,
    );

    const { computedLines, taxInputs } = this.computeLines(draft.lines, taxType, taxConfig);
    const totals = calculateInvoiceTotals(taxInputs);
    const taxSummary = buildTaxSummary(taxInputs);
    const numberingConfig = this.numberingConfigFor(draft.kind);

    return withImmediateTransaction(this.db, () => {
      const allocation = this.numbering.allocate(company.id, args.invoiceDate, numberingConfig);
      const snapshot: InvoiceSnapshot = {
        kind: draft.kind,
        company,
        customer,
        bill_to: customer.bill_to,
        ship_to: customer.ship_to,
        place_of_supply: draft.place_of_supply,
        references: draft.references,
        lines: computedLines,
        totals,
        tax_summary: taxSummary,
        tax_rate_config: taxConfig,
        payment_terms: draft.payment_terms,
        payment_mode: draft.payment_mode,
        payment_type: draft.payment_type,
        due_date: draft.due_date,
        notes: draft.notes,
        terms: draft.terms,
        declaration: draft.declaration,
        source_document_type: draft.source_document_type,
        source_document_number: draft.source_document_number,
        grand_total_words: amountInWords(totals.grand_total),
        tax_amount_words: amountInWords(
          totals.total_cgst.plus(totals.total_sgst).plus(totals.total_igst),
        ),
        logo_asset_id: company.logo_asset_id,
        signature_asset_id: company.signature_asset_id,
      };
      const finalized: Invoice = {
        ...draft,
        status: InvoiceStatus.FINALIZED,
        invoice_number: allocation.invoice_number,
        invoice_date: this.toIso(args.invoiceDate),
        company_id: company.id,
        lines: computedLines,
        totals,
        template_version: DEFAULT_TEMPLATE_VERSION,
        snapshot,
      };
      this.invoices.save(finalized);
      return finalized;
    });
  }

  /** Cancel a finalized invoice, preserving the record and its number. */
  cancel(
    invoiceId: string,
    reason: string,
    when?: Date | null,
    replacementInvoiceId?: string | null,
  ): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (invoice === null) throw new InvoiceServiceError('invoice not found');
    if (invoice.status !== InvoiceStatus.FINALIZED) {
      throw new InvoiceServiceError('only a FINALIZED invoice can be cancelled');
    }
    const cancelled: Invoice = {
      ...invoice,
      status: InvoiceStatus.CANCELLED,
      cancelled_at: this.toIso(when ?? this.clock.now()),
      cancel_reason: reason,
      replacement_invoice_id: replacementInvoiceId ?? null,
    };
    withImmediateTransaction(this.db, () => this.invoices.save(cancelled));
    return cancelled;
  }

  /** Duplicate an invoice into a NEW draft (editable content only). */
  duplicate(invoiceId: string): Invoice {
    const source = this.invoices.get(invoiceId);
    if (source === null) throw new InvoiceServiceError('invoice not found');

    const copiedLines: InvoiceLine[] = source.lines.map((line) => ({
      ...line,
      id: this.ids(),
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
    }));

    const duplicate: Invoice = {
      ...this.emptyInvoice(),
      id: this.ids(),
      kind: source.kind,
      status: InvoiceStatus.DRAFT,
      invoice_number: null,
      customer_id: source.customer_id,
      party_id: source.party_id,
      place_of_supply: source.place_of_supply,
      references: source.references,
      lines: copiedLines,
      payment_terms: source.payment_terms,
      payment_mode: source.payment_mode,
      payment_type: source.payment_type,
      due_date: source.due_date,
      notes: source.notes,
      terms: source.terms,
      declaration: source.declaration,
      // A duplicate is a fresh document; it does not carry the source link.
    };
    withImmediateTransaction(this.db, () => this.invoices.save(duplicate));
    return duplicate;
  }

  /** Change payment status only; never touches financials/number/snapshot. */
  setPaymentStatus(invoiceId: string, status: PaymentStatus): Invoice {
    const invoice = this.invoices.get(invoiceId);
    if (invoice === null) throw new InvoiceServiceError('invoice not found');
    const updated: Invoice = { ...invoice, payment_status: status };
    withImmediateTransaction(this.db, () => this.invoices.save(updated));
    return updated;
  }

  deleteDraft(invoiceId: string): void {
    withImmediateTransaction(this.db, () => {
      // An order that was converted into this invoice references it via
      // orders.converted_invoice_id. Clear that link first so deleting the
      // (still-draft) invoice never trips the foreign key; the source order
      // simply becomes convertible again.
      this.db
        .prepare('UPDATE orders SET converted_invoice_id = NULL WHERE converted_invoice_id = ?')
        .run(invoiceId);
      this.invoices.deleteDraft(invoiceId);
    });
  }

  // --- helpers ---

  private computeLines(
    lines: InvoiceLine[],
    taxType: TaxType,
    taxConfig: ReturnType<SettingsService['getTaxRateConfig']>,
  ): { computedLines: InvoiceLine[]; taxInputs: TaxLineInput[] } {
    const computedLines: InvoiceLine[] = [];
    const taxInputs: TaxLineInput[] = [];
    for (const line of lines) {
      ensureSupportedTreatment(line.tax_treatment);
      const amounts = calculateLine(line.quantity, line.rate, line.discount_percent);
      const tax = calculateLineTax(amounts.taxable, taxType, taxConfig);
      computedLines.push({
        ...line,
        tax_rate: taxConfig.total_rate,
        taxable_amount: amounts.taxable,
        cgst_amount: tax.cgst,
        sgst_amount: tax.sgst,
        igst_amount: tax.igst,
      });
      taxInputs.push({
        hsn_sac: line.hsn_sac,
        tax_treatment: line.tax_treatment,
        tax_type: taxType,
        tax_rate: taxConfig.total_rate,
        taxable: amounts.taxable,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
      });
    }
    return { computedLines, taxInputs };
  }

  /**
   * Resolve company + the billing party. SALES/JOB_WORK/CUSTOM bill a customer
   * (from the customers table). A PURCHASE invoice records a purchase from a
   * vendor (from the party master) — the vendor is projected into a
   * Customer-shaped party object so the engine, validation, and snapshot all
   * work unchanged; the persisted invoice keeps customer_id null and carries the
   * vendor via party_id + snapshot.
   */
  private resolveParties(invoice: Invoice): { company: Company; customer: Customer } {
    const company = this.companies.getActive();
    if (company === null) throw new InvoiceServiceError('no active company is configured');

    if (invoice.kind === InvoiceKind.PURCHASE) {
      if (invoice.party_id === null) {
        throw new InvoiceServiceError('purchase invoice has no vendor selected');
      }
      const party = this.parties.get(invoice.party_id);
      if (party === null) throw new InvoiceServiceError('selected vendor does not exist');
      return { company, customer: this.partyAsCustomer(party) };
    }

    if (invoice.customer_id === null) {
      throw new InvoiceServiceError('invoice has no customer selected');
    }
    const customer = this.customers.get(invoice.customer_id);
    if (customer === null) throw new InvoiceServiceError('selected customer does not exist');
    return { company, customer };
  }

  /** Project a vendor party into the invoice-facing Customer shape. */
  private partyAsCustomer(party: Party): Customer {
    const addr = (a: PartyAddress) => ({
      line: [a.address1, a.address2, a.landmark, a.city, a.pincode]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', '),
      state_name: a.state,
      state_code: a.state_code,
      godown: '',
    });
    const bill = addr(party.billing_address);
    const ship = addr(party.shipping_address ?? party.billing_address);
    return {
      id: party.id,
      name: party.company_name,
      gstin: party.gstin,
      phone: party.contact_no,
      email: party.email,
      bill_to: bill,
      ship_to: ship,
      is_active: party.is_active,
    };
  }

  private numberingConfigFor(kind: InvoiceKind): NumberingConfig {
    const base = this.settings.getNumberingConfig() ?? DEFAULT_NUMBERING_CONFIG;
    return { ...base, prefix: INVOICE_KIND_PREFIX[kind] };
  }

  private toIso(date: Date): string {
    // Store the calendar date (invoice dates are date-only).
    return date.toISOString().slice(0, 10);
  }

  private emptyInvoice(): Invoice {
    return {
      id: '',
      kind: InvoiceKind.SALES,
      invoice_number: null,
      status: InvoiceStatus.DRAFT,
      payment_status: PaymentStatus.UNPAID,
      invoice_date: '',
      company_id: null,
      customer_id: null,
      party_id: null,
      place_of_supply: { state_name: '', state_code: '' },
      references: {
        delivery_note: '',
        delivery_note_date: '',
        reference_number: '',
        reference_date: '',
        buyer_order_number: '',
        buyer_order_date: '',
        dispatch_doc_number: '',
        dispatch_date: '',
        lr_rr_number: '',
        vehicle_number: '',
        dispatched_through: '',
        destination: '',
        terms_of_delivery: '',
        other_references: '',
      },
      lines: [],
      totals: null,
      payment_terms: '',
      payment_mode: '',
      payment_type: '',
      due_date: '',
      notes: '',
      terms: '',
      declaration: '',
      source_document_type: '',
      source_document_number: '',
      source_document_id: null,
      template_version: null,
      snapshot: null,
      cancelled_at: '',
      cancel_reason: '',
      replacement_invoice_id: null,
    };
  }
}
