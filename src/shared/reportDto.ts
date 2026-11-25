/**
 * Dashboard report DTOs. All values are computed on the main process from
 * persisted finalized (non-cancelled) invoices and product master data —
 * nothing is hardcoded. Money crosses as decimal strings.
 */

export interface KpiSummary {
  /** Finalized (non-cancelled) sales for the current month. */
  sales_this_month: string;
  tax_this_month: string;
  invoices_this_month: number;
  /** All-time finalized totals. */
  total_sales: string;
  total_tax: string;
  finalized_count: number;
  /** Outstanding receivables (finalized, not PAID) by payment bucket. */
  receivables_total: string;
  receivables_unpaid: string;
  receivables_partial: string;
}

export interface MonthPoint {
  /** e.g. "2026-06" */
  key: string;
  /** e.g. "Jun 2026" */
  label: string;
  sales_count: number;
  sales_amount: string;
}

export interface ProductRank {
  name: string;
  quantity: string;
  amount: string;
}

export interface LowStockItem {
  name: string;
  available: string;
  threshold: string;
  unit: string;
}

export interface NamedAmount {
  name: string;
  amount: string;
  count: number;
}

export interface DashboardReport {
  kpi: KpiSummary;
  months: MonthPoint[];
  best_selling: ProductRank[];
  least_selling: ProductRank[];
  low_stock: LowStockItem[];
  /** Total number of low-stock products (may exceed the truncated low_stock list). */
  low_stock_total: number;
  top_customers: NamedAmount[];
  /** Convenience flag for empty-state rendering. */
  has_data: boolean;
}
