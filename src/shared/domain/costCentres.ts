/**
 * Cost Centres & Project / Machine Profitability Engine.
 * Allows tracking revenue, direct purchases, expenses, and net profit per machine or project.
 */

export const UNTAGGED = '__untagged';

export interface CostCentre {
  id: string;
  name: string;
  code: string;
  isArchived: boolean;
  createdAt: string;
}

export interface CostCentreRow {
  id: string;
  name: string;
  code: string;
  isArchived: boolean;
  salesTaxable: number;
  salesTax: number;
  salesTotal: number;
  purchases: number;
  expenses: number;
  profit: number;
  documentCount: number;
}

export interface CostCentreReportResult {
  rows: CostCentreRow[];
  total: {
    salesTaxable: number;
    salesTax: number;
    salesTotal: number;
    purchases: number;
    expenses: number;
    profit: number;
    documentCount: number;
  };
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function costCentreReport(params: {
  centres: CostCentre[];
  bills: Array<{
    costCentreId?: string | null;
    taxable: number;
    tax: number;
    total: number;
    date: string;
  }>;
  purchases?: Array<{
    costCentreId?: string | null;
    taxable: number;
    date: string;
  }>;
  expenses?: Array<{
    costCentreId?: string | null;
    amount: number;
    date: string;
  }>;
  from?: string;
  to?: string;
}): CostCentreReportResult {
  const { centres, bills, purchases = [], expenses = [], from = '', to = '' } = params;

  const inRange = (d: string) => (!from || d >= from) && (!to || d <= to);

  const rowsMap = new Map<string, CostCentreRow>();
  const makeBlank = (id: string, name: string, code = '', isArchived = false): CostCentreRow => ({
    id,
    name,
    code,
    isArchived,
    salesTaxable: 0,
    salesTax: 0,
    salesTotal: 0,
    purchases: 0,
    expenses: 0,
    profit: 0,
    documentCount: 0,
  });

  // Pre-seed with configured centres
  for (const c of centres) {
    rowsMap.set(c.id, makeBlank(c.id, c.name, c.code, c.isArchived));
  }

  const getOrCreateRow = (id: string | null | undefined): CostCentreRow => {
    const key = id || UNTAGGED;
    if (!rowsMap.has(key)) {
      rowsMap.set(key, makeBlank(key, key === UNTAGGED ? 'Untagged / General' : 'Other Centre'));
    }
    return rowsMap.get(key)!;
  };

  // 1. Process Outward Invoices
  for (const b of bills) {
    if (!inRange(b.date)) continue;
    const row = getOrCreateRow(b.costCentreId);
    row.salesTaxable = round2(row.salesTaxable + b.taxable);
    row.salesTax = round2(row.salesTax + b.tax);
    row.salesTotal = round2(row.salesTotal + b.total);
    row.documentCount += 1;
  }

  // 2. Process Purchases
  for (const p of purchases) {
    if (!inRange(p.date)) continue;
    const row = getOrCreateRow(p.costCentreId);
    row.purchases = round2(row.purchases + p.taxable);
    row.documentCount += 1;
  }

  // 3. Process Expenses
  for (const e of expenses) {
    if (!inRange(e.date)) continue;
    const row = getOrCreateRow(e.costCentreId);
    row.expenses = round2(row.expenses + e.amount);
    row.documentCount += 1;
  }

  // Calculate profit per row and aggregate totals
  const total = {
    salesTaxable: 0,
    salesTax: 0,
    salesTotal: 0,
    purchases: 0,
    expenses: 0,
    profit: 0,
    documentCount: 0,
  };

  const rows: CostCentreRow[] = [];
  for (const row of rowsMap.values()) {
    row.profit = round2(row.salesTaxable - row.purchases - row.expenses);
    total.salesTaxable = round2(total.salesTaxable + row.salesTaxable);
    total.salesTax = round2(total.salesTax + row.salesTax);
    total.salesTotal = round2(total.salesTotal + row.salesTotal);
    total.purchases = round2(total.purchases + row.purchases);
    total.expenses = round2(total.expenses + row.expenses);
    total.profit = round2(total.profit + row.profit);
    total.documentCount += row.documentCount;
    rows.push(row);
  }

  return { rows, total };
}
