import { describe, it, expect } from 'vitest';
import {
  validateCashEntry,
  cashBookView,
  cashSummary,
  type CashLine,
} from './cashBook';
import {
  periodMonths,
  buildPartyOutstanding,
  type OutstandingEntry,
} from './partyOutstanding';
import {
  costCentreReport,
  type CostCentre,
} from './costCentres';

describe('Daily Cash Book Domain', () => {
  it('validates cash entry fields', () => {
    expect(validateCashEntry({ type: 'in', amount: 500, date: '2026-08-15' })).toBe('');
    expect(validateCashEntry({ type: 'in', amount: 0, date: '2026-08-15' })).toContain('greater than 0');
    expect(validateCashEntry({ type: 'out', amount: 100, date: 'invalid-date' })).toContain('valid date');
  });

  it('calculates running balance and period opening/closing', () => {
    const lines: CashLine[] = [
      {
        key: '1',
        source: 'own',
        label: 'Opening',
        type: 'in',
        date: '2026-08-01',
        amount: 10000,
        name: 'Opening Balance',
        note: '',
        category: 'Opening balance',
      },
      {
        key: '2',
        source: 'own',
        label: 'Tea',
        type: 'out',
        date: '2026-08-05',
        amount: 250,
        name: 'Workshop Tea',
        note: '',
        category: 'Tea & snacks',
      },
      {
        key: '3',
        source: 'own',
        label: 'Scrap Sale',
        type: 'in',
        date: '2026-08-10',
        amount: 2500,
        name: 'Steel Scrap Cash',
        note: '',
        category: 'Sales',
      },
    ];

    const view = cashBookView(lines, { from: '2026-08-05', to: '2026-08-15' });

    // Prior to 2026-08-05: Opening 10,000
    expect(view.opening).toBe(10000);
    // Period rows: -250 (out) and +2500 (in) -> net +2250
    expect(view.rows.length).toBe(2);
    expect(view.totals.in).toBe(2500);
    expect(view.totals.out).toBe(250);
    expect(view.totals.net).toBe(2250);
    // Closing = 10000 + 2250 = 12250
    expect(view.closing).toBe(12250);
  });

  it('calculates cash in hand summary', () => {
    const lines: CashLine[] = [
      { key: '1', source: 'own', label: '', type: 'in', date: '2026-08-15', amount: 5000, name: '', note: '', category: '' },
      { key: '2', source: 'own', label: '', type: 'out', date: '2026-08-15', amount: 1200, name: '', note: '', category: '' },
    ];
    const summary = cashSummary(lines, '2026-08-15');
    expect(summary.inHand).toBe(3800);
    expect(summary.today.net).toBe(3800);
  });
});

describe('Party Outstanding Aging Matrix', () => {
  it('generates 12 monthly columns for FY starting April', () => {
    const cols = periodMonths('fy', 2026);
    expect(cols.length).toBe(12);
    expect(cols[0].key).toBe('2026-04');
    expect(cols[11].key).toBe('2027-03');
  });

  it('bins party outstandings into monthly buckets and earlier overdue column', () => {
    const cols = periodMonths('fy', 2026);
    const entries: OutstandingEntry[] = [
      // In period: May 2026
      { partyName: 'Alpha Moulds Pvt Ltd', invoiceDate: '2026-05-10', dueAmount: 50000 },
      // In period: August 2026
      { partyName: 'Alpha Moulds Pvt Ltd', invoiceDate: '2026-08-20', dueAmount: 30000 },
      // Prior to period: Feb 2026 (earlier overdue)
      { partyName: 'Alpha Moulds Pvt Ltd', invoiceDate: '2026-02-15', dueAmount: 15000 },
      // Other party: June 2026
      { partyName: 'Beta Plastics', invoiceDate: '2026-06-12', dueAmount: 25000 },
    ];

    const matrix = buildPartyOutstanding(entries, cols);
    expect(matrix.length).toBe(2);

    const alpha = matrix.find((r) => r.name === 'Alpha Moulds Pvt Ltd')!;
    expect(alpha.earlier).toBe(15000);
    expect(alpha.months['2026-05']).toBe(50000);
    expect(alpha.months['2026-08']).toBe(30000);
    expect(alpha.total).toBe(95000);

    const beta = matrix.find((r) => r.name === 'Beta Plastics')!;
    expect(beta.earlier).toBe(0);
    expect(beta.months['2026-06']).toBe(25000);
    expect(beta.total).toBe(25000);
  });
});

describe('Cost Centres & Job Costing', () => {
  const centres: CostCentre[] = [
    { id: 'vmc1', name: 'VMC Center 1', code: 'MC-01', isArchived: false, createdAt: '' },
    { id: 'gundrill', name: 'Gun Drilling Center', code: 'MC-02', isArchived: false, createdAt: '' },
  ];

  it('calculates profitability per machine / cost centre', () => {
    const report = costCentreReport({
      centres,
      bills: [
        { costCentreId: 'vmc1', taxable: 100000, tax: 18000, total: 118000, date: '2026-08-10' },
        { costCentreId: 'gundrill', taxable: 60000, tax: 10800, total: 70800, date: '2026-08-12' },
      ],
      purchases: [
        { costCentreId: 'vmc1', taxable: 40000, date: '2026-08-05' }, // Tooling cutters
      ],
      expenses: [
        { costCentreId: 'vmc1', amount: 10000, date: '2026-08-08' }, // Coolant & electricity
        { costCentreId: 'gundrill', amount: 5000, date: '2026-08-09' }, // Drill inserts
      ],
    });

    const vmcRow = report.rows.find((r) => r.id === 'vmc1')!;
    expect(vmcRow.salesTaxable).toBe(100000);
    expect(vmcRow.purchases).toBe(40000);
    expect(vmcRow.expenses).toBe(10000);
    // Profit = 100000 - 40000 - 10000 = 50000
    expect(vmcRow.profit).toBe(50000);

    const drillRow = report.rows.find((r) => r.id === 'gundrill')!;
    expect(drillRow.salesTaxable).toBe(60000);
    expect(drillRow.expenses).toBe(5000);
    // Profit = 60000 - 5000 = 55000
    expect(drillRow.profit).toBe(55000);

    expect(report.total.profit).toBe(105000);
  });
});
