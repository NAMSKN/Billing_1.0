import { describe, it, expect } from 'vitest';
import { Money } from './money';
import { InvoiceStatus, PaymentStatus, TaxTreatment } from './enums';
import {
  isValidGstin,
  isValidIfsc,
  isValidEmail,
  validateDraft,
  validateForFinalization,
  isOk,
  blockingIssues,
} from './validation';
import {
  emptyAddress,
  emptyReferences,
  type Company,
  type Customer,
  type Invoice,
  type InvoiceLine,
} from './models';

describe('offline format validators', () => {
  it('GSTIN', () => {
    expect(isValidGstin('29ABCDE1234F1Z5')).toBe(true);
    expect(isValidGstin('badgstin')).toBe(false);
  });
  it('IFSC', () => {
    expect(isValidIfsc('HDFC0001234')).toBe(true);
    expect(isValidIfsc('HDFC1234567')).toBe(false);
  });
  it('email', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('nope')).toBe(false);
  });
});

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    sequence: 0,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: 'Gun drilling',
    specification: '',
    hsn_sac: '998898',
    quantity: new Money('1'),
    unit: 'NOS',
    rate: new Money('100'),
    discount_percent: new Money('0'),
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: new Money('18'),
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
    ...overrides,
  };
}

function invoice(lines: InvoiceLine[], posCode = '29'): Invoice {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    invoice_number: null,
    status: InvoiceStatus.DRAFT,
    payment_status: PaymentStatus.UNPAID,
    invoice_date: '',
    company_id: null,
    customer_id: null,
    place_of_supply: { state_name: 'Karnataka', state_code: posCode },
    references: emptyReferences(),
    lines,
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
    replacement_invoice_id: '',
  } as Invoice;
}

function company(): Company {
  return {
    id: 'c',
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

function customer(): Customer {
  return {
    id: 'cust',
    name: 'DI-TECH MOULDS',
    gstin: '',
    phone: '',
    email: '',
    bill_to: { line: '12 Industrial Area', state_name: 'Karnataka', state_code: '29', godown: '' },
    ship_to: emptyAddress(),
    is_active: true,
  };
}

describe('validateDraft (permissive)', () => {
  it('empty draft is ok (warnings only)', () => {
    const result = validateDraft(invoice([]));
    expect(isOk(result)).toBe(true);
    expect(result.issues.some((i) => i.severity === 'WARNING')).toBe(true);
  });

  it('malformed quantity is blocking even in a draft', () => {
    const result = validateDraft(invoice([line({ quantity: new Money('0') })]));
    expect(isOk(result)).toBe(false);
  });
});

describe('validateForFinalization (strict)', () => {
  it('passes with valid company, customer, date, PoS, and line', () => {
    const result = validateForFinalization(invoice([line()]), {
      company: company(),
      customer: customer(),
      invoiceDate: new Date(2026, 5, 1),
    });
    expect(isOk(result)).toBe(true);
  });

  it('blocks when there are no lines', () => {
    const result = validateForFinalization(invoice([]), {
      company: company(),
      customer: customer(),
      invoiceDate: new Date(2026, 5, 1),
    });
    expect(isOk(result)).toBe(false);
    expect(blockingIssues(result).some((i) => i.field === 'lines')).toBe(true);
  });

  it('blocks when place of supply is missing', () => {
    const result = validateForFinalization(invoice([line()], ''), {
      company: company(),
      customer: customer(),
      invoiceDate: new Date(2026, 5, 1),
    });
    expect(blockingIssues(result).some((i) => i.field === 'place_of_supply.state_code')).toBe(true);
  });

  it('blocks a due date earlier than the invoice date', () => {
    const result = validateForFinalization(invoice([line()]), {
      company: company(),
      customer: customer(),
      invoiceDate: new Date(2026, 5, 10),
      dueDate: new Date(2026, 5, 1),
    });
    expect(blockingIssues(result).some((i) => i.field === 'due_date')).toBe(true);
  });
});
