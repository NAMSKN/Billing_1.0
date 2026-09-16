import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { InvoiceStatus, PaymentStatus, TaxTreatment, TaxType } from '@shared/domain/enums';
import { emptyAddress } from '@shared/domain/models';
import type { Company, Customer, Invoice, InvoiceLine } from '@shared/domain/models';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from './composition';
import { FinalizationError } from './invoiceService';

/**
 * Lifecycle tests: draft edit, strict finalization, atomic finalization +
 * rollback, snapshot immutability, cancellation, duplication, numbering
 * (transactional allocation, uniqueness, no reuse, FY rollover). The two golden
 * invoices are reproduced end-to-end through finalize().
 */

let app: Application;
let company: Company;
let customer: Customer;

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering',
    address: { line: 'Plot 1', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '29ABCDE1234F1Z5',
    email: '',
    phone: '',
    bank_name: '',
    account_number: '',
    branch: '',
    ifsc: '',
    upi_id: '',
    authorized_signatory: 'Owner',
    logo_asset_id: null,
    signature_asset_id: null,
    active: true,
  };
}

function makeCustomer(): Customer {
  return {
    id: uuidv4(),
    name: 'DI-TECH MOULDS',
    gstin: '',
    phone: '',
    email: '',
    bill_to: { line: '12 Area', state_name: 'Karnataka', state_code: '29', godown: '' },
    ship_to: emptyAddress(),
    is_active: true,
  };
}

/** A single line whose taxable resolves to a target value (qty 1 x rate). */
function lineWithTaxable(rate: string): InvoiceLine {
  return {
    id: uuidv4(),
    sequence: 0,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: 'Machining service',
    specification: '',
    hsn_sac: '998898',
    quantity: new Money('1'),
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

function draftWith(lines: InvoiceLine[], posCode = '29'): Invoice {
  const draft = app.invoiceService.createDraft();
  const edited: Invoice = {
    ...draft,
    customer_id: customer.id,
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
    lines,
  };
  app.invoiceService.saveDraft(edited);
  return app.invoiceService.get(edited.id)!;
}

beforeEach(() => {
  const db = connectMemory();
  // Deterministic id generator not needed for these assertions; use uuid4.
  app = buildApplicationFromDb(db);
  company = makeCompany();
  app.companyRepo.save(company);
  customer = makeCustomer();
  app.customerRepo.save(customer);
});

afterEach(() => {
  app.close();
});

describe('draft lifecycle', () => {
  it('creates a draft with no number and DRAFT status', () => {
    const draft = app.invoiceService.createDraft();
    expect(draft.status).toBe(InvoiceStatus.DRAFT);
    expect(draft.invoice_number).toBeNull();
    expect(app.invoiceService.get(draft.id)).not.toBeNull();
  });

  it('save_draft rejects a non-draft', () => {
    const draft = draftWith([lineWithTaxable('100')]);
    const finalized = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
    expect(() => app.invoiceService.saveDraft(finalized)).toThrow();
  });
});

describe('golden invoices reproduce end-to-end through finalize', () => {
  it('043: taxable 12280 -> grand 14490.00, round-off -0.40', () => {
    const draft = draftWith([lineWithTaxable('12280')]);
    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
    expect(inv.status).toBe(InvoiceStatus.FINALIZED);
    expect(inv.invoice_number).toBe('SE/26-27/001');
    expect(inv.totals!.grand_total.toFixed(2)).toBe('14490.00');
    expect(inv.totals!.round_off.toFixed(2)).toBe('-0.40');
    expect(inv.totals!.total_cgst.toFixed(2)).toBe('1105.20');
    expect(inv.snapshot!.grand_total_words).toBe(
      'INR Fourteen Thousand Four Hundred Ninety Only',
    );
    expect(inv.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTRA_STATE);
  });

  it('089: taxable 8332 -> grand 9832.00, round-off +0.24', () => {
    const draft = draftWith([lineWithTaxable('8332')]);
    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
    expect(inv.totals!.grand_total.toFixed(2)).toBe('9832.00');
    expect(inv.totals!.round_off.toFixed(2)).toBe('0.24');
    expect(inv.totals!.total_cgst.toFixed(2)).toBe('749.88');
  });

  it('inter-state place of supply produces IGST', () => {
    const draft = draftWith([lineWithTaxable('12280')], '27');
    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
    expect(inv.totals!.total_igst.toFixed(2)).toBe('2210.40');
    expect(inv.totals!.total_cgst.toFixed(2)).toBe('0.00');
    expect(inv.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTER_STATE);
  });
});

describe('finalization is strict and atomic', () => {
  it('blocks finalization when there are no lines and leaves the draft unchanged', () => {
    const draft = draftWith([]);
    expect(() => app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) })).toThrow(
      FinalizationError,
    );
    const reloaded = app.invoiceService.get(draft.id)!;
    expect(reloaded.status).toBe(InvoiceStatus.DRAFT);
    expect(reloaded.invoice_number).toBeNull();
  });
});

describe('numbering', () => {
  it('allocates sequential numbers and never reuses after cancel', () => {
    const a = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    const b = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    expect(a.invoice_number).toBe('SE/26-27/001');
    expect(b.invoice_number).toBe('SE/26-27/002');

    app.invoiceService.cancel(a.id, 'mistake');
    const c = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    // 001 is not released; next is 003.
    expect(c.invoice_number).toBe('SE/26-27/003');
  });

  it('FY rollover: a different financial year restarts the sequence', () => {
    const a = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1), // FY 26-27
    });
    const b = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2027, 5, 1), // FY 27-28
    });
    expect(a.invoice_number).toBe('SE/26-27/001');
    expect(b.invoice_number).toBe('SE/27-28/001');
  });
});

describe('cancellation preserves the record and number', () => {
  it('cancels a finalized invoice, keeping id, number, and snapshot', () => {
    const inv = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    const cancelled = app.invoiceService.cancel(inv.id, 'customer withdrew', new Date(2026, 5, 2));
    expect(cancelled.status).toBe(InvoiceStatus.CANCELLED);
    expect(cancelled.id).toBe(inv.id);
    expect(cancelled.invoice_number).toBe(inv.invoice_number);
    expect(cancelled.snapshot).not.toBeNull();
    expect(cancelled.cancel_reason).toBe('customer withdrew');
  });

  it('refuses to cancel a draft', () => {
    const draft = draftWith([lineWithTaxable('1000')]);
    expect(() => app.invoiceService.cancel(draft.id, 'x')).toThrow();
  });
});

describe('snapshot immutability', () => {
  it('editing the customer master does not change a finalized snapshot', () => {
    const inv = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    // Mutate the master.
    app.customerRepo.save({ ...customer, name: 'CHANGED NAME' });
    const reloaded = app.invoiceService.get(inv.id)!;
    expect(reloaded.snapshot!.customer.name).toBe('DI-TECH MOULDS');
  });
});

describe('duplication creates a new draft only', () => {
  it('copies editable content, clears number/status/totals', () => {
    const inv = app.invoiceService.finalize(draftWith([lineWithTaxable('1000')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    const dup = app.invoiceService.duplicate(inv.id);
    expect(dup.id).not.toBe(inv.id);
    expect(dup.status).toBe(InvoiceStatus.DRAFT);
    expect(dup.invoice_number).toBeNull();
    expect(dup.totals).toBeNull();
    expect(dup.snapshot).toBeNull();
    expect(dup.customer_id).toBe(customer.id);
    expect(dup.lines).toHaveLength(1);
    expect(dup.lines[0].taxable_amount).toBeNull();
  });
});

describe('payment status is independent of lifecycle', () => {
  it('changing payment status does not change financials or number', () => {
    const inv = app.invoiceService.finalize(draftWith([lineWithTaxable('12280')]).id, {
      invoiceDate: new Date(2026, 5, 1),
    });
    const paid = app.invoiceService.setPaymentStatus(inv.id, PaymentStatus.PAID);
    expect(paid.payment_status).toBe(PaymentStatus.PAID);
    expect(paid.status).toBe(InvoiceStatus.FINALIZED);
    expect(paid.invoice_number).toBe(inv.invoice_number);
    expect(paid.totals!.grand_total.toFixed(2)).toBe('14490.00');
  });
});
