import { describe, it, expect } from 'vitest';
import {
  parseDateFrom,
  parseInvoiceNumber,
  parseSupplierName,
  parseGrandTotal,
  parseTaxBreakdown,
  parseLineItems,
  matchProduct,
  heuristicParseBill,
} from './purchaseOcr';

describe('Purchase Bill OCR Heuristics', () => {
  const sampleBillText = `
    TAX INVOICE
    BALAJI STEELS & TOOLING WORKS
    Plot No. 42, Industrial Estate, Peenya, Bengaluru
    GSTIN: 29AABCB1234F1Z5
    State: Karnataka (29)

    Invoice No: INV-2026/0491
    Date: 14/08/2026

    Bill To:
    PRECISION MOULDS & DIES
    GSTIN: 29XYZPA5678Q1Z2

    Sl  Description of Goods          HSN     Qty  Rate      Amount
    1.  EN31 ALLOY STEEL ROUND BAR   7228    2    4500.00   9000.00
    2.  P20 PRE-HARDENED TOOL STEEL  7228    1    12500.00  12500.00

    Sub Total: 21500.00
    CGST 9%: 1935.00
    SGST 9%: 1935.00
    Round Off: 0.00
    Grand Total: ₹25,370.00
  `;

  it('extracts GSTIN, invoice number, and dates accurately', () => {
    expect(parseDateFrom(sampleBillText)).toBe('2026-08-14');
    expect(parseInvoiceNumber(sampleBillText)).toBe('INV-2026/0491');
    expect(parseSupplierName(sampleBillText)).toBe('BALAJI STEELS & TOOLING WORKS');
    expect(parseGrandTotal(sampleBillText)).toBe(25370);
  });

  it('extracts tax breakdown totals', () => {
    const tax = parseTaxBreakdown(sampleBillText);
    expect(tax.taxableValue).toBe(21500);
    expect(tax.cgst).toBe(1935);
    expect(tax.sgst).toBe(1935);
  });

  it('extracts line items with rate, quantity, and HSN', () => {
    const items = parseLineItems(sampleBillText);
    expect(items.length).toBe(2);
    expect(items[0].name).toContain('EN31 ALLOY STEEL ROUND BAR');
    expect(items[0].hsn).toBe('7228');
    expect(items[0].quantity).toBe(2);
    expect(items[0].rate).toBe(4500);
    expect(items[0].amount).toBe(9000);

    expect(items[1].name).toContain('P20 PRE-HARDENED TOOL STEEL');
    expect(items[1].rate).toBe(12500);
  });

  it('matches products against catalog with fuzzy token matching', () => {
    const catalog = [
      { id: 'prod-1', name: 'Alloy Steel Bar EN-31', hsn: '7228', taxPercent: 18 },
      { id: 'prod-2', name: 'Copper Electrode Rod', hsn: '7407', taxPercent: 18 },
    ];

    const match = matchProduct('EN31 ALLOY STEEL ROUND BAR', catalog);
    expect(match).not.toBeNull();
    expect(match?.product.id).toBe('prod-1');
  });

  it('runs complete heuristic parse bill pipeline', () => {
    const parsed = heuristicParseBill(sampleBillText, [
      { id: 'p1', name: 'EN-31 Tool Steel', hsn: '7228', taxPercent: 18 },
    ]);
    expect(parsed.supplierGstin).toBe('29AABCB1234F1Z5');
    expect(parsed.invoiceNumber).toBe('INV-2026/0491');
    expect(parsed.grandTotal).toBe(25370);
    expect(parsed.items.length).toBe(2);
  });
});
