import { describe, it, expect } from 'vitest';
import { isHsnSplitRequired, formatDateGST, stripEmpty, validateGstr1Preflight } from './gstr1';
import { buildGstr3bPayload } from './gstr3b';
import { parseGstr2bJson, reconcileGstr2b, type PurchaseRecord } from './gstr2b';

describe('GSTR-1 Domain Rules', () => {
  it('correctly requires HSN split for return periods from May 2025 onwards', () => {
    expect(isHsnSplitRequired('042025')).toBe(false);
    expect(isHsnSplitRequired('052025')).toBe(true);
    expect(isHsnSplitRequired('082026')).toBe(true);
  });

  it('formats dates to standard GST portal DD-MM-YYYY format', () => {
    expect(formatDateGST('2026-08-15')).toBe('15-08-2026');
  });

  it('strips empty fields, nulls, and empty arrays for GST portal compliance', () => {
    const raw = {
      gstin: '29AABCU9603R1ZM',
      emptyStr: '',
      nullVal: null,
      validZero: 0,
      emptyList: [],
      sub: {
        keep: 'yes',
        drop: '',
      },
    };
    const cleaned = stripEmpty(raw);
    expect(cleaned).toEqual({
      gstin: '29AABCU9603R1ZM',
      validZero: 0,
      sub: { keep: 'yes' },
    });
  });

  it('validates preflight blocking rules for invoice numbers and dates', () => {
    const check1 = validateGstr1Preflight([
      { invoice_number: 'INV/001', invoice_date: '2026-08-15' },
    ]);
    expect(check1.blocked.length).toBe(0);

    const check2 = validateGstr1Preflight([
      { invoice_number: 'TOOL-INV-EXCEEDING-16-CHARS', invoice_date: '2026-08-15' },
    ]);
    expect(check2.blocked.length).toBeGreaterThan(0);
    expect(check2.blocked[0]).toContain('16-character limit');
  });
});

describe('GSTR-3B Computation', () => {
  it('correctly builds GSTR-3B schema v1.7 payload with proper table mapping', () => {
    const payload = buildGstr3bPayload({
      gstin: '29AABCU9603R1ZM',
      ret_period: '082026',
      outwardTaxable: {
        txval: 100000,
        iamt: 18000,
        camt: 0,
        samt: 0,
        csamt: 0,
      },
      itcOther: {
        iamt: 5000,
        camt: 0,
        samt: 0,
        csamt: 0,
      },
    });

    expect(payload.gstin).toBe('29AABCU9603R1ZM');
    expect(payload.ret_period).toBe('082026');
    expect(payload.sup_details.osup_det.txval).toBe(100000);
    expect(payload.sup_details.osup_det.iamt).toBe(18000);
    expect(payload.itc_elg.itc_net.iamt).toBe(5000);
  });
});

describe('GSTR-2B Auto-Reconciliation Engine', () => {
  const sample2b = {
    data: {
      docdata: {
        b2b: [
          {
            ctin: '27AABCU9603R1ZM',
            cname: 'STEEL SUPPLIERS LTD',
            inv: [
              {
                inum: 'STEEL/101',
                idt: '10-08-2026',
                val: 118000,
                items: [{ txval: 100000, iamt: 18000, camt: 0, samt: 0, csamt: 0 }],
                itcavl: 'Y',
              },
              {
                inum: 'STEEL/102',
                idt: '12-08-2026',
                val: 59000,
                items: [{ txval: 50000, iamt: 9000, camt: 0, samt: 0, csamt: 0 }],
                itcavl: 'Y',
              },
            ],
          },
        ],
      },
    },
  };

  it('correctly categorizes matched, books-only, and 2B-only invoices', () => {
    const parsedTwoB = parseGstr2bJson(sample2b);
    expect(parsedTwoB.length).toBe(2);

    const books: PurchaseRecord[] = [
      // Matched invoice
      {
        id: '1',
        supplierGstin: '27AABCU9603R1ZM',
        supplierName: 'STEEL SUPPLIERS LTD',
        invoiceNumber: 'STEEL-101', // Slightly different formatting (hyphen vs slash)
        invoiceDate: '2026-08-10',
        taxableValue: 100000,
        igst: 18000,
        cgst: 0,
        sgst: 0,
        cess: 0,
        total: 118000,
      },
      // Books-only invoice (vendor hasn't filed GSTR-1 yet)
      {
        id: '2',
        supplierGstin: '29XYZCU1234R1ZZ',
        supplierName: 'LOCAL TOOLING SPUR',
        invoiceNumber: 'LTS-888',
        invoiceDate: '2026-08-14',
        taxableValue: 20000,
        igst: 0,
        cgst: 1800,
        sgst: 1800,
        cess: 0,
        total: 23600,
      },
    ];

    const result = reconcileGstr2b(books, parsedTwoB);

    expect(result.summary.matchedCount).toBe(1);
    expect(result.summary.booksOnlyCount).toBe(1);
    expect(result.summary.twoBOnlyCount).toBe(1); // STEEL/102 was in 2B but not in books
    expect(result.summary.unclaimedTax).toBe(9000);
    expect(result.summary.atRiskTax).toBe(3600);
  });
});
