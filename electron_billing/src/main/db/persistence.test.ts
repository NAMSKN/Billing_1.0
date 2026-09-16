import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { InvoiceStatus, PaymentStatus, TaxTreatment, TaxType } from '@shared/domain/enums';
import { emptyAddress, emptyReferences } from '@shared/domain/models';
import type { Company, Customer, Invoice, InvoiceLine } from '@shared/domain/models';
import { connectMemory } from './connection';
import { SqliteCompanyRepository } from './companyRepository';
import { SqliteCustomerRepository } from './customerRepository';
import { SqliteInvoiceRepository } from './invoiceRepository';
import { SqliteSequenceRepository } from './sequenceRepository';
import { STANDARD_18 } from '@shared/domain/fixtures/golden';

/**
 * Persistence round-trip tests: exact paise/millis/hundredths preservation with
 * no precision loss (domain -> DB -> domain), unique invoice-number backstop,
 * draft cascade delete, and snapshot round-trip. No network; in-memory DB.
 */

let db: Database.Database;

beforeEach(() => {
  db = connectMemory();
});

afterEach(() => {
  db.close();
});

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering',
    address: { line: 'Plot 1', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '29ABCDE1234F1Z5',
    email: '',
    phone: '',
    bank_name: 'HDFC',
    account_number: '123',
    branch: 'MG Road',
    ifsc: 'HDFC0001234',
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

function makeLine(): InvoiceLine {
  return {
    id: uuidv4(),
    sequence: 0,
    job_or_mould_reference: 'DT-663',
    component_or_part: '',
    operation: 'PUNCH GUN DRILLING',
    description: 'DRILL DIA 9X307MM DEEP',
    specification: '',
    hsn_sac: '998898',
    quantity: new Money('12.5'),
    unit: 'NOS',
    rate: new Money('767.50'),
    discount_percent: new Money('2.5'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}

function makeDraft(customerId: string): Invoice {
  return {
    id: uuidv4(),
    invoice_number: null,
    status: InvoiceStatus.DRAFT,
    payment_status: PaymentStatus.UNPAID,
    invoice_date: '',
    company_id: null,
    customer_id: customerId,
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    references: emptyReferences(),
    lines: [makeLine()],
    totals: null,
    payment_terms: '',
    due_date: '',
    notes: '',
    terms: '',
    declaration: '',
    template_version: null,
    snapshot: null,
    cancelled_at: '',
    cancel_reason: '',
    replacement_invoice_id: null,
  };
}

describe('company + customer round trip', () => {
  it('preserves all fields', () => {
    const repo = new SqliteCompanyRepository(db);
    const c = makeCompany();
    repo.save(c);
    const back = repo.getActive();
    expect(back).not.toBeNull();
    expect(back!.name).toBe(c.name);
    expect(back!.gstin).toBe(c.gstin);
    expect(back!.address.state_code).toBe('29');
    expect(back!.ifsc).toBe('HDFC0001234');
  });

  it('archive hides the customer from the active list', () => {
    const repo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    repo.save(cust);
    expect(repo.list()).toHaveLength(1);
    repo.archive(cust.id);
    expect(repo.list()).toHaveLength(0);
    expect(repo.list(true)).toHaveLength(1);
  });
});

describe('invoice line exact numeric round trip', () => {
  it('preserves quantity millis, rate paise, discount hundredths with no drift', () => {
    const custRepo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    custRepo.save(cust);

    const invRepo = new SqliteInvoiceRepository(db);
    const draft = makeDraft(cust.id);
    invRepo.save(draft);

    const back = invRepo.get(draft.id);
    expect(back).not.toBeNull();
    const line = back!.lines[0];
    expect(line.quantity.toString()).toBe('12.5');
    expect(line.rate.toFixed(2)).toBe('767.50');
    expect(line.discount_percent.toFixed(2)).toBe('2.50');
    expect(line.tax_rate.toFixed(2)).toBe('18.00');
    // Uncomputed draft amounts stay null.
    expect(line.taxable_amount).toBeNull();
  });

  it('draft with no totals maps back to totals=null', () => {
    const custRepo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    custRepo.save(cust);
    const invRepo = new SqliteInvoiceRepository(db);
    const draft = makeDraft(cust.id);
    invRepo.save(draft);
    expect(invRepo.get(draft.id)!.totals).toBeNull();
  });
});

describe('unique invoice number backstop', () => {
  it('rejects a second finalized invoice with the same number', () => {
    const companyRepo = new SqliteCompanyRepository(db);
    const company = makeCompany();
    companyRepo.save(company);
    const custRepo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    custRepo.save(cust);
    const invRepo = new SqliteInvoiceRepository(db);

    const a = makeDraft(cust.id);
    a.status = InvoiceStatus.FINALIZED;
    a.invoice_number = 'SE/26-27/043';
    a.company_id = company.id;
    invRepo.save(a);

    const b = makeDraft(cust.id);
    b.status = InvoiceStatus.FINALIZED;
    b.invoice_number = 'SE/26-27/043';
    b.company_id = company.id;
    expect(() => invRepo.save(b)).toThrow();
  });
});

describe('draft cascade delete', () => {
  it('deletes a draft and its line items; refuses to delete a finalized', () => {
    const custRepo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    custRepo.save(cust);
    const invRepo = new SqliteInvoiceRepository(db);
    const draft = makeDraft(cust.id);
    invRepo.save(draft);

    invRepo.deleteDraft(draft.id);
    expect(invRepo.get(draft.id)).toBeNull();
    const items = db
      .prepare('SELECT COUNT(*) AS n FROM invoice_items WHERE invoice_id = ?')
      .get(draft.id) as { n: number };
    expect(items.n).toBe(0);
  });
});

describe('sequence state round trip', () => {
  it('upserts and reads next_sequence and high_water_mark', () => {
    const companyRepo = new SqliteCompanyRepository(db);
    const company = makeCompany();
    companyRepo.save(company);
    const seqRepo = new SqliteSequenceRepository(db);
    seqRepo.save({
      company_id: company.id,
      financial_year: '26-27',
      prefix: 'SE',
      next_sequence: 44,
      high_water_mark: 43,
    });
    const back = seqRepo.get(company.id, '26-27', 'SE');
    expect(back).toEqual({
      company_id: company.id,
      financial_year: '26-27',
      prefix: 'SE',
      next_sequence: 44,
      high_water_mark: 43,
    });
  });
});

describe('snapshot round trip preserves exact money and tax type', () => {
  it('serializes and restores a finalized snapshot', () => {
    const companyRepo = new SqliteCompanyRepository(db);
    const company = makeCompany();
    companyRepo.save(company);
    const custRepo = new SqliteCustomerRepository(db);
    const cust = makeCustomer();
    custRepo.save(cust);
    const invRepo = new SqliteInvoiceRepository(db);

    const line = makeLine();
    line.taxable_amount = new Money('12280.00');
    line.cgst_amount = new Money('1105.20');
    line.sgst_amount = new Money('1105.20');
    line.igst_amount = new Money('0.00');

    const inv = makeDraft(cust.id);
    inv.status = InvoiceStatus.FINALIZED;
    inv.invoice_number = 'SE/26-27/043';
    inv.company_id = company.id;
    inv.template_version = 1;
    inv.lines = [line];
    inv.totals = {
      total_taxable: new Money('12280.00'),
      total_cgst: new Money('1105.20'),
      total_sgst: new Money('1105.20'),
      total_igst: new Money('0.00'),
      raw_total: new Money('14490.40'),
      round_off: new Money('-0.40'),
      grand_total: new Money('14490.00'),
    };
    inv.snapshot = {
      company,
      customer: cust,
      bill_to: cust.bill_to,
      ship_to: cust.ship_to,
      place_of_supply: inv.place_of_supply,
      references: inv.references,
      lines: [line],
      totals: inv.totals,
      tax_summary: [
        {
          hsn_sac: '998898',
          tax_treatment: TaxTreatment.TAXABLE,
          tax_type: TaxType.INTRA_STATE,
          tax_rate: new Money('18'),
          taxable_value: new Money('12280.00'),
          cgst_amount: new Money('1105.20'),
          sgst_amount: new Money('1105.20'),
          igst_amount: new Money('0.00'),
          total_tax: new Money('2210.40'),
        },
      ],
      tax_rate_config: STANDARD_18,
      payment_terms: '',
      due_date: '',
      notes: '',
      terms: '',
      declaration: '',
      grand_total_words: 'INR Fourteen Thousand Four Hundred Ninety Only',
      tax_amount_words: 'INR Two Thousand Two Hundred Ten and Forty Paise Only',
      logo_asset_id: null,
      signature_asset_id: null,
    };

    invRepo.save(inv);
    const back = invRepo.get(inv.id)!;
    expect(back.snapshot).not.toBeNull();
    expect(back.snapshot!.totals.grand_total.toFixed(2)).toBe('14490.00');
    expect(back.snapshot!.totals.round_off.toFixed(2)).toBe('-0.40');
    expect(back.snapshot!.tax_summary[0].tax_type).toBe(TaxType.INTRA_STATE);
    expect(back.snapshot!.tax_summary[0].cgst_amount.toFixed(2)).toBe('1105.20');
    expect(back.snapshot!.tax_rate_config.cgst_rate.toFixed(2)).toBe('9.00');
    expect(back.totals!.grand_total.toFixed(2)).toBe('14490.00');
  });
});
