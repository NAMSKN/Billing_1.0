/**
 * Daily Cash Book Domain Engine.
 * Tracks cash in, cash out, cash in hand, and running balance for workshop operations.
 */

export const CASH_CATEGORIES = [
  'Opening balance',
  'Sales',
  'Advance',
  'Salary',
  'Tea & snacks',
  'Transport',
  'Owner drawing',
  'Deposit to bank',
  'Raw Material / Tooling',
  'Electricity / Utilities',
  'Other',
] as const;

export type CashCategory = (typeof CASH_CATEGORIES)[number];

export interface CashEntry {
  id: string;
  type: 'in' | 'out';
  amount: number; // in Rupees
  date: string; // YYYY-MM-DD
  name: string;
  note: string;
  category: string;
  createdAt: string;
}

export interface CashLine {
  key: string;
  source: 'own' | 'invoice' | 'receipt' | 'payment';
  label: string;
  type: 'in' | 'out';
  date: string;
  amount: number;
  name: string;
  note: string;
  category: string;
  balance?: number;
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function validateCashEntry(e: Partial<CashEntry>): string {
  if (!e || typeof e !== 'object') return 'Invalid entry';
  if (e.type !== 'in' && e.type !== 'out') return 'Select Money In or Money Out';
  const amt = Number(e.amount);
  if (!Number.isFinite(amt) || round2(amt) <= 0) return 'Enter an amount greater than 0';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(e.date || ''))) return 'Enter a valid date (YYYY-MM-DD)';
  return '';
}

export function cashTotals(lines: CashLine[]): { in: number; out: number; net: number } {
  let tIn = 0;
  let tOut = 0;
  for (const l of lines) {
    if (l.type === 'in') tIn += l.amount;
    else tOut += l.amount;
  }
  return {
    in: round2(tIn),
    out: round2(tOut),
    net: round2(tIn - tOut),
  };
}

/**
 * Computes running balance for a list of lines ordered by date,
 * calculating opening balance, period lines, and closing balance.
 */
export function cashBookView(
  lines: CashLine[],
  options: { from?: string; to?: string; search?: string } = {},
): {
  opening: number;
  rows: CashLine[];
  totals: { in: number; out: number; net: number };
  closing: number;
} {
  const { from = '', to = '', search = '' } = options;

  // Sort lines chronologically (oldest first)
  const sorted = [...lines].sort((a, b) => {
    const cmp = a.date.localeCompare(b.date);
    if (cmp !== 0) return cmp;
    if (a.type === b.type) return a.key.localeCompare(b.key);
    return a.type === 'in' ? -1 : 1; // 'in' before 'out' on same date
  });

  let running = 0;
  const withBalance: CashLine[] = sorted.map((l) => {
    running = round2(running + (l.type === 'out' ? -l.amount : l.amount));
    return { ...l, balance: running };
  });

  const opening = round2(
    withBalance
      .filter((l) => from && l.date < from)
      .reduce((s, l) => s + (l.type === 'out' ? -l.amount : l.amount), 0),
  );

  const periodLines = withBalance.filter(
    (l) => (!from || l.date >= from) && (!to || l.date <= to),
  );

  const q = search.trim().toLowerCase();
  const rows = q
    ? periodLines.filter((l) =>
        [l.name, l.note, l.category, l.label, String(l.amount)].some((field) =>
          String(field || '').toLowerCase().includes(q),
        ),
      )
    : periodLines;

  const totals = cashTotals(rows);
  const closing = round2(opening + totals.net);

  return { opening, rows, totals, closing };
}

/** Computes summary metrics: cash in hand currently, today's in/out, and month's in/out. */
export function cashSummary(
  lines: CashLine[],
  today = new Date().toISOString().split('T')[0],
): {
  inHand: number;
  today: { in: number; out: number; net: number };
  month: { in: number; out: number; net: number };
} {
  const monthPrefix = today.slice(0, 7);
  return {
    inHand: cashTotals(lines.filter((l) => l.date <= today)).net,
    today: cashTotals(lines.filter((l) => l.date === today)),
    month: cashTotals(lines.filter((l) => l.date.slice(0, 7) === monthPrefix)),
  };
}
