import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { PaymentStatus, TaxTreatment } from '@shared/domain/enums';
import { ItemType, StockType, DiscountType, CessType } from '@shared/domain/product';
import { emptyAddress } from '@shared/domain/models';
import type { Company, Customer, InvoiceLine } from '@shared/domain/models';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import type { Clock } from './clock';
import type { ProductInput } from './productService';

/**
 * Report tests: analytics computed from finalized invoices + products, nothing
 * hardcoded. A fixed clock makes "this month" deterministic.
 */

const FIXED_NOW = new Date(2026, 5, 15); // Jun 2026
const clock: Clock = { now: () => FIXED_NOW };

let app: Application;
let company: Company;
let customerA: Customer;
let customerB: Customer;

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering',
    address: { line: 'X', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '',
    email: '',
    phone: '',
    bank_name: '',
    account_number: '',
    branch: '',
    ifsc: '',
    upi_id: '',
    authorized_signatory: '',
    logo_asset_id: null,
    signature_asset_id: null,
    active: true,
  };
}
function makeCustomer(name: string): Customer {
  return {
    id: uuidv4(),
    name,
    gstin: '',
    phone: '',
    email: '',
    bill_to: { line: '1', state_name: 'Karnataka', state_code: '29', godown: '' },
    ship_to: emptyAddress(),
    is_active: true,
  };
}
function line(desc: string, qty: string, rate: string): InvoiceLine {
  return {
    id: uuidv4(),
    sequence: 0,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: desc,
    specification: '',
    hsn_sac: '998898',
    quantity: new Money(qty),
    unit: 'NOS',
    rate: new Money(rate),
    discount_percent: new Money('0'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}
function productInput(name: string, qty: string | null, low: string | null): ProductInput {
  return {
    item_type: ItemType.PRODUCT,
    name,
    note: '',
    barcode_no: '',
    hsn_sac_code: '998898',
    unit_of_measurement: 'NOS',
    tax_rate: new Money('18'),
    cess_percent: new Money('0'),
    cess_type: CessType.FIXED,
    cess_amount: new Money('0'),
    no_itc: false,
    sell_price: new Money('100'),
    sell_price_incl_tax: new Money('118'),
    sale_discount_type: DiscountType.RUPEE,
    sale_discount_value: new Money('0'),
    purchase_price: new Money('0'),
    purchase_price_incl_tax: new Money('0'),
    purchase_discount_type: DiscountType.RUPEE,
    purchase_discount_value: new Money('0'),
    stock_type: StockType.NORMAL,
    opening_qty: qty === null ? null : new Money(qty),
    low_stock_alert: low === null ? null : new Money(low),
    product_group_id: null,
    image_asset_id: null,
    is_manufactured: false,
    is_sellable: true,
    visible_on_documents: false,
  };
}

function finalize(
  customerId: string,
  lines: InvoiceLine[],
  date: Date,
  payment: PaymentStatus = PaymentStatus.UNPAID,
) {
  const draft = app.invoiceService.createDraft();
  app.invoiceService.saveDraft({
    ...draft,
    customer_id: customerId,
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    lines,
  });
  const inv = app.invoiceService.finalize(draft.id, { invoiceDate: date });
  if (payment !== PaymentStatus.UNPAID) app.invoiceService.setPaymentStatus(inv.id, payment);
  return inv;
}

beforeEach(() => {
  app = buildApplicationFromDb(connectMemory(), { clock });
  company = makeCompany();
  app.companyRepo.save(company);
  customerA = makeCustomer('Alpha Ltd');
  customerB = makeCustomer('Beta Corp');
  app.customerRepo.save(customerA);
  app.customerRepo.save(customerB);
});
afterEach(() => app.close());

describe('empty report', () => {
  it('has no data when nothing is finalized', () => {
    const r = app.reportService.build();
    expect(r.has_data).toBe(false);
    expect(r.kpi.total_sales).toBe('0.00');
    expect(r.months).toHaveLength(6);
    expect(r.best_selling).toEqual([]);
  });
});

describe('KPIs and monthly series', () => {
  it('aggregates finalized invoices; this month vs earlier', () => {
    // June 2026 (this month): 12280 taxable -> grand 14490.00
    finalize(customerA.id, [line('Widget', '1', '12280')], new Date(2026, 5, 10));
    // April 2026 (earlier): 8332 taxable -> grand 9832.00
    finalize(customerB.id, [line('Gadget', '1', '8332')], new Date(2026, 3, 5));

    const r = app.reportService.build();
    expect(r.kpi.finalized_count).toBe(2);
    expect(r.kpi.sales_this_month).toBe('14490.00');
    expect(r.kpi.invoices_this_month).toBe(1);
    expect(r.kpi.total_sales).toBe('24322.00'); // 14490 + 9832
    expect(r.has_data).toBe(true);

    // Months window ends at Jun 2026 (6 months: Jan..Jun).
    const jun = r.months.find((m) => m.key === '2026-06')!;
    expect(jun.sales_count).toBe(1);
    expect(jun.sales_amount).toBe('14490.00');
    const apr = r.months.find((m) => m.key === '2026-04')!;
    expect(apr.sales_amount).toBe('9832.00');
  });

  it('receivables count only unpaid/partial finalized invoices', () => {
    finalize(customerA.id, [line('X', '1', '1000')], new Date(2026, 5, 1), PaymentStatus.UNPAID);
    finalize(customerA.id, [line('X', '1', '1000')], new Date(2026, 5, 2), PaymentStatus.PAID);
    const r = app.reportService.build();
    // Only the unpaid one contributes (grand of 1000 taxable = 1180.00).
    expect(r.kpi.receivables_total).toBe('1180.00');
    expect(r.kpi.receivables_unpaid).toBe('1180.00');
  });
});

describe('best/least selling and top customers', () => {
  it('ranks by line quantity and customer billed amount', () => {
    finalize(customerA.id, [line('Popular', '10', '100'), line('Rare', '1', '100')], new Date(2026, 5, 1));
    finalize(customerB.id, [line('Popular', '5', '100')], new Date(2026, 5, 2));

    const r = app.reportService.build();
    expect(r.best_selling[0].name).toBe('Popular');
    expect(r.best_selling[0].quantity).toBe('15');
    expect(r.least_selling[0].name).toBe('Rare');
    // Alpha billed more (2 lines) than Beta.
    expect(r.top_customers[0].name).toBe('Alpha Ltd');
  });
});

describe('low stock', () => {
  it('lists products at or below their alert threshold', () => {
    app.productService.createProduct(productInput('Low Widget', '5', '10')); // 5 <= 10 -> low
    app.productService.createProduct(productInput('OK Widget', '100', '10')); // not low
    app.productService.createProduct(productInput('No Threshold', '0', null)); // no alert -> ignored

    const r = app.reportService.build();
    expect(r.low_stock.map((x) => x.name)).toEqual(['Low Widget']);
    expect(r.low_stock[0].available).toBe('5');
    expect(r.low_stock[0].threshold).toBe('10');
    expect(r.has_data).toBe(true);
  });
});
