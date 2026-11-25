/**
 * Tally-Style Party Outstanding & Aging Domain Engine.
 * Matrix showing parties down the vertical axis and months across horizontally.
 */

export interface MonthColumn {
  key: string; // "YYYY-MM"
  label: string; // "Apr 26"
}

export interface PartyOutstandingRow {
  name: string;
  earlier: number; // Unpaid balance prior to the selected period
  months: Record<string, number>; // key: "YYYY-MM" -> amount
  total: number;
}

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function getFinancialYearStart(date = new Date()): number {
  const m = date.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
  return m >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** Generates 12 monthly period columns for a Financial Year or Calendar Year. */
export function periodMonths(mode: 'fy' | 'calendar', startYear: number): MonthColumn[] {
  const firstMonth = mode === 'fy' ? 3 : 0; // April (3) or January (0)
  return Array.from({ length: 12 }, (_, i) => {
    const m = (firstMonth + i) % 12;
    const y = startYear + Math.floor((firstMonth + i) / 12);
    const key = `${y}-${String(m + 1).padStart(2, '0')}`;
    const label = `${MONTH_SHORT[m]} '${String(y).slice(-2)}`;
    return { key, label };
  });
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export interface OutstandingEntry {
  partyName: string;
  invoiceDate: string; // YYYY-MM-DD
  dueAmount: number; // Unpaid balance in Rupees
}

/** Builds matrix rows grouped by party, with earlier balances and monthly bins. */
export function buildPartyOutstanding(
  entries: OutstandingEntry[],
  months: MonthColumn[],
): PartyOutstandingRow[] {
  if (months.length === 0) return [];
  const firstKey = months[0].key;
  const lastKey = months[months.length - 1].key;

  const rowsMap = new Map<string, PartyOutstandingRow>();

  for (const { partyName, invoiceDate, dueAmount } of entries) {
    if (!dueAmount || dueAmount <= 0) continue;
    const ym = String(invoiceDate || '').slice(0, 7);
    if (!ym || ym > lastKey) continue;

    const name = String(partyName || '').trim() || 'Unknown Party';
    const id = name.toLowerCase();

    if (!rowsMap.has(id)) {
      rowsMap.set(id, { name, earlier: 0, months: {}, total: 0 });
    }

    const row = rowsMap.get(id)!;
    const due = round2(dueAmount);

    if (ym < firstKey) {
      row.earlier = round2(row.earlier + due);
    } else {
      row.months[ym] = round2((row.months[ym] || 0) + due);
    }
    row.total = round2(row.total + due);
  }

  return [...rowsMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}
