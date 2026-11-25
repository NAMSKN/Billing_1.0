import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { Money } from '@shared/domain/money';
import { LineItemType, TaxTreatment } from '@shared/domain/enums';
import { emptyAddress } from '@shared/domain/models';
import type { Company, Customer, Invoice, InvoiceLine } from '@shared/domain/models';
import { connectMemory } from '../db/connection';
import { buildApplicationFromDb, type Application } from '../app/composition';
import { buildRenderDto } from './renderDto';
import { renderInvoicePdf } from './renderer';
import { PdfService } from './pdfService';

/**
 * PDF tests. Content equivalence, not byte equality (DECISIONS D-031): we
 * assert the render DTO reproduces the golden aggregate values exactly, that a
 * valid multi-section A4 PDF is produced, optional fields are omitted, and
 * special characters render without throwing.
 */

let app: Application;
let company: Company;
let customer: Customer;

function makeCompany(): Company {
  return {
    id: uuidv4(),
    name: 'Sri Engineering & Moulds',
    address: { line: 'Plot 1, Industrial Estate', state_name: 'Karnataka', state_code: '29', godown: '' },
    gstin: '29ABCDE1234F1Z5',
    email: '',
    phone: '',
    bank_name: 'HDFC Bank',
    account_number: '5010001234',
    branch: 'MG Road',
    ifsc: 'HDFC0001234',
    upi_id: 'sri@upi',
    authorized_signatory: 'A. Rao',
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

function line(rate: string, extras: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: uuidv4(),
    sequence: 0,
    item_type: LineItemType.PRODUCT,
    product_id: null,
    job_or_mould_reference: 'DT-663',
    component_or_part: '',
    operation: 'PUNCH GUN DRILLING',
    description: 'DRILL DIA 9X307MM DEEP',
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
    ...extras,
  };
}

function finalizeWith(lines: InvoiceLine[]): Invoice {
  const draft = app.invoiceService.createDraft();
  app.invoiceService.saveDraft({
    ...draft,
    customer_id: customer.id,
    place_of_supply: { state_name: 'Karnataka', state_code: '29' },
    lines,
  });
  return app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
}

beforeEach(() => {
  app = buildApplicationFromDb(connectMemory());
  company = makeCompany();
  app.companyRepo.save(company);
  customer = makeCustomer();
  app.customerRepo.save(customer);
});

afterEach(() => app.close());

describe('render DTO reproduces golden content exactly', () => {
  it('043 aggregate values appear in the DTO', () => {
    const inv = finalizeWith([line('12280')]);
    const dto = buildRenderDto(inv);
    expect(dto.invoice_number).toBe('SE/26-27/001');
    expect(dto.is_intra_state).toBe(true);
    expect(dto.totals.taxable).toBe('12,280.00');
    expect(dto.totals.cgst).toBe('1,105.20');
    expect(dto.totals.sgst).toBe('1,105.20');
    expect(dto.totals.round_off).toBe('-0.40');
    expect(dto.totals.grand_total).toBe('14,490.00');
    expect(dto.grand_total_words).toBe('INR Fourteen Thousand Four Hundred Ninety Only');
    expect(dto.tax_summary[0].cgst_rate).toBe('9.00');
  });

  it('089 aggregate values appear in the DTO', () => {
    const inv = finalizeWith([line('8332')]);
    const dto = buildRenderDto(inv);
    expect(dto.totals.grand_total).toBe('9,832.00');
    expect(dto.totals.round_off).toBe('0.24');
  });
});

describe('pdfkit renderer', () => {
  it('produces a valid non-empty PDF buffer', async () => {
    const inv = finalizeWith([line('12280')]);
    const pdf = await renderInvoicePdf(buildRenderDto(inv));
    expect(pdf.length).toBeGreaterThan(1000);
    // PDF magic header.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // Has an EOF marker.
    expect(pdf.subarray(-32).toString('latin1')).toContain('%%EOF');
  });

  it('renders special characters (& < > x) and long content without throwing', async () => {
    const longDesc = '6 SIDE MACHINING 510X430X130 & FINISH < 0.02 > TOLERANCE '.repeat(6);
    const inv = finalizeWith([
      line('1000', { operation: 'A & B <milling>', description: longDesc }),
      line('2000'),
      line('3000'),
    ]);
    const pdf = await renderInvoicePdf(buildRenderDto(inv));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('omits the references block when all optional refs are empty', async () => {
    const inv = finalizeWith([line('1000')]);
    const dto = buildRenderDto(inv);
    expect(dto.references).toHaveLength(0);
    // Still renders fine.
    const pdf = await renderInvoicePdf(dto);
    expect(pdf.length).toBeGreaterThan(500);
  });

  it('inter-state invoice renders IGST columns', async () => {
    const draft = app.invoiceService.createDraft();
    app.invoiceService.saveDraft({
      ...draft,
      customer_id: customer.id,
      place_of_supply: { state_name: 'Maharashtra', state_code: '27' },
      lines: [line('12280')],
    });
    const inv = app.invoiceService.finalize(draft.id, { invoiceDate: new Date(2026, 5, 1) });
    const dto = buildRenderDto(inv);
    expect(dto.is_intra_state).toBe(false);
    expect(dto.totals.igst).toBe('2,210.40');
    const pdf = await renderInvoicePdf(dto);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/**
 * Count pages in a pdfkit document. Each page carries exactly one /MediaBox,
 * so counting those is a stable page count for these documents.
 */
function countPages(pdf: Buffer): number {
  const matches = pdf.toString('latin1').match(/\/MediaBox/g);
  return matches ? matches.length : 0;
}

describe('single-page layout (no overflow / phantom pages)', () => {
  it('a normal one-line invoice fits on exactly one page', async () => {
    const inv = finalizeWith([line('12280')]);
    const pdf = await renderInvoicePdf(buildRenderDto(inv));
    expect(countPages(pdf)).toBe(1);
  });
});

describe('copy markers (presentation-only, Tally wording)', () => {
  it('default render is a single Original copy on one page', async () => {
    const inv = finalizeWith([line('12280')]);
    const pdf = await renderInvoicePdf(buildRenderDto(inv));
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(pdf)).toBe(1);
  });

  it('renders an explicit single copy label without throwing', async () => {
    const inv = finalizeWith([line('12280')]);
    const pdf = await renderInvoicePdf(buildRenderDto(inv), ['Duplicate for Supplier/Transporter']);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(pdf)).toBe(1);
  });

  it('multiple copies produce one page per copy in a single PDF', async () => {
    const inv = finalizeWith([line('12280')]);
    const labels = [
      'Original for Recipient',
      'Duplicate for Supplier/Transporter',
      'Triplicate for Supplier',
    ];
    const pdf = await renderInvoicePdf(buildRenderDto(inv), labels);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(countPages(pdf)).toBe(3);
  });

  it('the render DTO copy_label defaults to empty (set per rendered copy)', () => {
    const inv = finalizeWith([line('12280')]);
    expect(buildRenderDto(inv).copy_label).toBe('');
  });
});

describe('PdfService copy options', () => {
  it('exports a deterministic filename', () => {
    expect(PdfService.exportFilename('SE/26-27/043')).toBe('INV_SE_26-27_043.pdf');
  });

  it('render throws for a non-finalized invoice (no snapshot)', async () => {
    const draft = app.invoiceService.createDraft();
    const svc = new PdfService();
    await expect(svc.render(app.invoiceService.get(draft.id)!)).rejects.toThrow();
  });

  it('single copy option renders one page; multiple renders three', async () => {
    const inv = finalizeWith([line('12280')]);
    const svc = new PdfService();
    const single = await svc.render(inv, { copyType: 'ORIGINAL' });
    expect(countPages(single)).toBe(1);
    const multi = await svc.render(inv, { copies: ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE'] });
    expect(countPages(multi)).toBe(3);
  });

  it('de-duplicates and canonically orders requested copies', async () => {
    const inv = finalizeWith([line('12280')]);
    const svc = new PdfService();
    // Duplicated + out of order -> two unique pages.
    const pdf = await svc.render(inv, { copies: ['DUPLICATE', 'ORIGINAL', 'DUPLICATE'] });
    expect(countPages(pdf)).toBe(2);
  });
});
