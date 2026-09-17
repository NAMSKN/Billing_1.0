import type Database from 'better-sqlite3';
import { InvoiceStatus, TaxType } from '@shared/domain/enums';
import type {
  Address,
  Company,
  Invoice,
  InvoiceLine,
  InvoiceTotals,
} from '@shared/domain/models';
import { emptyAddress, emptyReferences } from '@shared/domain/models';
import type { CompanyRepository, OrderRepository } from '@shared/domain/repositories';
import {
  OrderStatus,
  OrderType,
  OrderLineItemType,
  canTransition,
  emptyOrderParty,
  orderPartyIsVendor,
  type Order,
  type OrderLine,
  type OrderParty,
  type OrderSnapshot,
} from '@shared/domain/order';
import { isCustomerType, isVendorType, type Party, type PartyAddress } from '@shared/domain/party';
import type { PartyRepository } from '../db/partyRepository';
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
import type { NumberingConfig } from '@shared/domain/numbering';
import { withImmediateTransaction } from './unitOfWork';
import { NumberingService } from './numberingService';
import { SettingsService } from './settingsService';
import { InvoiceService } from './invoiceService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

const DEFAULT_TEMPLATE_VERSION = 1;

/** Distinct numbering prefixes per order type on the shared sequence table. */
const ORDER_PREFIX: Record<OrderType, string> = {
  SALES_ORDER: 'SO',
  PURCHASE_ORDER: 'PO',
  SERVICE_REQUEST: 'SR',
};

export class OrderServiceError extends Error {}
/** Illegal status transition attempted (or a terminal state). */
export class OrderTransitionError extends OrderServiceError {}
export class OrderConfirmError extends OrderServiceError {
  constructor(
    message: string,
    public readonly issues?: string[],
  ) {
    super(message);
  }
}

export interface OrderConfirmArgs {
  orderDate: Date;
  today?: Date | null;
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

function partyToOrderParty(party: Party): OrderParty {
  return {
    party_id: party.id,
    name: party.company_name,
    gstin: party.gstin,
    pan: party.pan,
    phone: party.contact_no,
    contact_person: party.contact_person,
    address: toDocumentAddress(party.billing_address),
  };
}

/**
 * Order lifecycle use cases (Sales Order / Purchase Order / Service Request).
 * The status machine is validated in this layer only — the frontend never sets
 * status arbitrarily (it calls confirm/complete/cancel). Transactions via
 * withImmediateTransaction (D-026). Reuses the calc engine and numbering.
 */
export class OrderService {
  constructor(
    private readonly db: Database.Database,
    private readonly orders: OrderRepository,
    private readonly companies: CompanyRepository,
    private readonly parties: PartyRepository,
    private readonly invoices: InvoiceService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  get(id: string): Order | null {
    return this.orders.get(id);
  }

  listSummaries(): Order[] {
    return this.orders.listSummaries();
  }

  createDraft(base?: Order): Order {
    const draft: Order = {
      ...(base ?? this.emptyOrder()),
      id: this.ids(),
      status: OrderStatus.DRAFT,
      order_number: null,
    };
    withImmediateTransaction(this.db, () => this.orders.save(draft));
    return draft;
  }

  saveDraft(order: Order): Order {
    if (order.status !== OrderStatus.DRAFT) {
      throw new OrderServiceError('save_draft is only valid for DRAFT orders');
    }
    if (order.order_number !== null) {
      throw new OrderServiceError('a draft must not carry an order number');
    }
    withImmediateTransaction(this.db, () => this.orders.save(order));
    return order;
  }

  /**
   * Confirm a draft: DRAFT -> CONFIRMED. Validates the party role matches the
   * order type, service requests are service-only, then allocates the order
   * number, computes totals, and pins the snapshot — all atomically.
   */
  confirm(orderId: string, args: OrderConfirmArgs): Order {
    const draft = this.orders.get(orderId);
    if (draft === null) throw new OrderConfirmError('order not found');
    if (!canTransition(draft.status, OrderStatus.CONFIRMED)) {
      throw new OrderTransitionError(
        `cannot confirm an order in status ${draft.status}`,
      );
    }

    const { company, party } = this.resolveParties(draft);
    const issues = this.validateForConfirmation(draft, party);
    if (issues.length) {
      throw new OrderConfirmError('order failed confirmation validation', issues);
    }

    const taxConfig = this.settings.getTaxRateConfig();
    const taxType = determineTaxType(
      company.address.state_code,
      draft.place_of_supply.state_code,
    );
    const { computedLines, taxInputs } = this.computeLines(draft.lines, taxType, taxConfig);
    const totals = calculateInvoiceTotals(taxInputs);
    const taxSummary = buildTaxSummary(taxInputs);
    const numberingConfig = this.orderNumberingConfig(draft.order_type);

    const orderParty = partyToOrderParty(party);
    const shipTo = this.resolveShipTo(draft, party);

    return withImmediateTransaction(this.db, () => {
      const allocation = this.numbering.allocate(company.id, args.orderDate, numberingConfig);
      const snapshot: OrderSnapshot = {
        company,
        order_type: draft.order_type,
        party: orderParty,
        ship_to: shipTo,
        place_of_supply: draft.place_of_supply,
        reverse_charge: draft.reverse_charge,
        delivery_mode: draft.delivery_mode,
        lines: computedLines,
        totals,
        tax_summary: taxSummary,
        tax_rate_config: taxConfig,
        notes: draft.notes,
        terms: draft.terms,
        document_note: draft.document_note,
        grand_total_words: amountInWords(totals.grand_total),
        tax_amount_words: amountInWords(
          totals.total_cgst.plus(totals.total_sgst).plus(totals.total_igst),
        ),
      };
      const confirmed: Order = {
        ...draft,
        status: OrderStatus.CONFIRMED,
        order_number: allocation.invoice_number,
        order_date: this.toIso(args.orderDate),
        company_id: company.id,
        party: orderParty,
        ship_to: shipTo,
        lines: computedLines,
        totals,
        template_version: DEFAULT_TEMPLATE_VERSION,
        snapshot,
      };
      this.orders.save(confirmed);
      return confirmed;
    });
  }

  /** Complete a confirmed order: CONFIRMED -> COMPLETED. */
  complete(orderId: string): Order {
    const order = this.orders.get(orderId);
    if (order === null) throw new OrderServiceError('order not found');
    if (!canTransition(order.status, OrderStatus.COMPLETED)) {
      throw new OrderTransitionError(`cannot complete an order in status ${order.status}`);
    }
    const completed: Order = { ...order, status: OrderStatus.COMPLETED };
    withImmediateTransaction(this.db, () => this.orders.save(completed));
    return completed;
  }

  /** Cancel a draft or confirmed order. Preserves the record and its number. */
  cancel(orderId: string, reason: string, when?: Date | null): Order {
    const order = this.orders.get(orderId);
    if (order === null) throw new OrderServiceError('order not found');
    if (!canTransition(order.status, OrderStatus.CANCELLED)) {
      throw new OrderTransitionError(`cannot cancel an order in status ${order.status}`);
    }
    const cancelled: Order = {
      ...order,
      status: OrderStatus.CANCELLED,
      cancelled_at: this.toIso(when ?? this.clock.now()),
      cancel_reason: reason,
    };
    withImmediateTransaction(this.db, () => this.orders.save(cancelled));
    return cancelled;
  }

  /** Duplicate an order into a NEW draft (editable content only). */
  duplicate(orderId: string): Order {
    const source = this.orders.get(orderId);
    if (source === null) throw new OrderServiceError('order not found');

    const copiedLines: OrderLine[] = source.lines.map((line) => ({
      ...line,
      id: this.ids(),
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
    }));

    const duplicate: Order = {
      ...this.emptyOrder(),
      id: this.ids(),
      status: OrderStatus.DRAFT,
      order_number: null,
      order_type: source.order_type,
      company_id: source.company_id,
      party_id: source.party_id,
      party: source.party,
      ship_to: source.ship_to,
      place_of_supply: source.place_of_supply,
      reverse_charge: source.reverse_charge,
      delivery_mode: source.delivery_mode,
      lines: copiedLines,
      notes: source.notes,
      terms: source.terms,
      document_note: source.document_note,
    };
    withImmediateTransaction(this.db, () => this.orders.save(duplicate));
    return duplicate;
  }

  deleteDraft(orderId: string): void {
    withImmediateTransaction(this.db, () => this.orders.deleteDraft(orderId));
  }

  /**
   * Convert a confirmed/completed order into a NEW invoice DRAFT. Party,
   * address, contact, GSTIN, reverse charge, ship-to, place of supply, and
   * lines are copied; the source order number/date are kept as a reference
   * only; a new invoice number is generated and tax + round-off are RECALCULATED
   * at the user's later finalize. Purchase orders cannot become invoices in V1
   * (there is no purchase-invoice model; an invoice bills a customer).
   */
  convertToInvoice(orderId: string): Invoice {
    const order = this.orders.get(orderId);
    if (order === null) throw new OrderServiceError('order not found');
    if (order.status !== OrderStatus.CONFIRMED && order.status !== OrderStatus.COMPLETED) {
      throw new OrderServiceError('only a confirmed or completed order can be converted');
    }
    if (order.order_type === OrderType.PURCHASE_ORDER) {
      throw new OrderServiceError(
        'Purchase order conversion to an invoice is not supported in V1 (an invoice bills a customer).',
      );
    }
    if (order.party_id === null) {
      throw new OrderServiceError('order has no party to carry to the invoice');
    }

    const references = {
      ...emptyReferences(),
      reference_number: order.order_number ?? '',
      reference_date: order.order_date,
    };

    const lines: InvoiceLine[] = order.lines.map((line, i) => ({
      id: this.ids(),
      sequence: i,
      job_or_mould_reference: '',
      component_or_part: '',
      operation: '',
      description: line.description,
      specification: '',
      hsn_sac: line.hsn_sac,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      discount_percent: line.discount_percent,
      tax_treatment: line.tax_treatment,
      tax_rate: line.tax_rate,
      // Calculated amounts stay null so the engine recomputes at finalize.
      taxable_amount: null,
      cgst_amount: null,
      sgst_amount: null,
      igst_amount: null,
    }));

    const base: Invoice = {
      id: '',
      invoice_number: null,
      status: InvoiceStatus.DRAFT,
      payment_status: 'UNPAID' as Invoice['payment_status'],
      invoice_date: '',
      company_id: null,
      customer_id: order.party_id,
      place_of_supply: order.place_of_supply,
      references,
      lines,
      totals: null,
      payment_terms: '',
      due_date: '',
      notes: order.notes,
      terms: order.terms,
      declaration: '',
      template_version: null,
      snapshot: null,
      cancelled_at: '',
      cancel_reason: '',
      replacement_invoice_id: null,
    };

    // createDraft persists a NEW invoice draft (fresh id, DRAFT, null number)
    // inside its own transaction; then we link it back on the order.
    const invoice = this.invoices.createDraft(base);
    const linked: Order = { ...order, converted_invoice_id: invoice.id };
    withImmediateTransaction(this.db, () => this.orders.save(linked));
    return invoice;
  }

  // --- helpers ---

  private orderNumberingConfig(type: OrderType): NumberingConfig {
    const base = this.settings.getNumberingConfig();
    return { ...base, prefix: ORDER_PREFIX[type] };
  }

  private computeLines(
    lines: OrderLine[],
    taxType: TaxType,
    taxConfig: ReturnType<SettingsService['getTaxRateConfig']>,
  ): { computedLines: OrderLine[]; taxInputs: TaxLineInput[] } {
    const computedLines: OrderLine[] = [];
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

  private resolveParties(order: Order): { company: Company; party: Party } {
    const company = this.companies.getActive();
    if (company === null) throw new OrderServiceError('no active company is configured');
    if (order.party_id === null) throw new OrderServiceError('order has no party selected');
    const party = this.parties.get(order.party_id);
    if (party === null) throw new OrderServiceError('selected party does not exist');
    return { company, party };
  }

  private resolveShipTo(order: Order, party: Party): Address {
    if (order.ship_to.line.trim() || order.ship_to.state_code.trim()) {
      return order.ship_to;
    }
    const shipping = party.shipping_address ?? party.billing_address;
    return toDocumentAddress(shipping);
  }

  private validateForConfirmation(order: Order, party: Party): string[] {
    const issues: string[] = [];
    if (!party.company_name.trim()) issues.push('Party name is required.');

    // Party role must match the order type.
    if (orderPartyIsVendor(order.order_type)) {
      if (!isVendorType(party.company_type)) {
        issues.push('A purchase order requires a vendor party.');
      }
    } else if (!isCustomerType(party.company_type)) {
      issues.push('This order type requires a customer party.');
    }

    if (!order.place_of_supply.state_code.trim()) {
      issues.push('Place of supply is required.');
    }

    const hasLine = order.lines.some(
      (l) => l.description.trim() || l.quantity.greaterThan(0) || l.rate.greaterThan(0),
    );
    if (!hasLine) issues.push('At least one line item is required.');

    // A service request is service-only.
    if (order.order_type === OrderType.SERVICE_REQUEST) {
      const allService = order.lines.every((l) => l.item_type === OrderLineItemType.SERVICE);
      if (!allService) issues.push('A service request may contain service items only.');
    }

    return issues;
  }

  private toIso(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private emptyOrder(): Order {
    return {
      id: '',
      order_number: null,
      order_type: OrderType.SALES_ORDER,
      status: OrderStatus.DRAFT,
      order_date: '',
      company_id: null,
      party_id: null,
      party: emptyOrderParty(),
      ship_to: emptyAddress(),
      place_of_supply: { state_name: '', state_code: '' },
      reverse_charge: false,
      delivery_mode: '',
      lines: [],
      totals: null as InvoiceTotals | null,
      notes: '',
      terms: '',
      document_note: '',
      template_version: null,
      snapshot: null,
      converted_invoice_id: null,
      cancelled_at: '',
      cancel_reason: '',
    };
  }
}
