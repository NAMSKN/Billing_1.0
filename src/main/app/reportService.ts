import type Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';
import { InvoiceStatus, PaymentStatus } from '@shared/domain/enums';
import type { Invoice } from '@shared/domain/models';
import { tracksStock } from '@shared/domain/product';
import type {
  DashboardReport,
  LowStockItem,
  MonthPoint,
  NamedAmount,
  ProductRank,
} from '@shared/reportDto';
import type { InvoiceRepository } from '@shared/domain/repositories';
import type { ProductService } from './productService';
import type { StockService } from './stockService';
import type { Clock } from './clock';
import { systemClock } from './clock';

/**
 * Dashboard reporting (data-driven). Aggregates ONLY finalized, non-cancelled
 * invoices (drafts/cancelled excluded) using stored snapshot values — nothing
 * is recalculated or hardcoded. Product analytics (low stock) come from the
 * product master. All months/series are derived from the actual data range.
 */

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function monthKey(iso: string): string | null {
  // invoice_date is yyyy-mm-dd.
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  return m ? `${m[1]}-${m[2]}` : null;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-');
  return `${MONTH_LABELS[Number(m) - 1]} ${y}`;
}

export class ReportService {
  constructor(
    private readonly invoices: InvoiceRepository,
    private readonly products: ProductService,
    private readonly stock: StockService,
    private readonly clock: Clock = systemClock,
    private readonly monthsBack = 6,
  ) {}

  build(): DashboardReport {
    // Load full finalized invoices (need snapshot lines for product analytics).
    const summaries = this.invoices.listSummaries();
    const finalized: Invoice[] = [];
    for (const s of summaries) {
      if (s.status !== InvoiceStatus.FINALIZED) continue;
      const full = this.invoices.get(s.id);
      if (full && full.snapshot) finalized.push(full);
    }

    const now = this.clock.now();
    const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // --- KPIs + monthly aggregation ---
    let salesThisMonth = new Money(0);
    let taxThisMonth = new Money(0);
    let invoicesThisMonth = 0;
    let totalSales = new Money(0);
    let totalTax = new Money(0);
    let receivablesTotal = new Money(0);
    let receivablesUnpaid = new Money(0);
    let receivablesPartial = new Money(0);

    const monthMap = new Map<string, { count: number; amount: Decimal }>();
    const productAgg = new Map<string, { qty: Decimal; amount: Decimal }>();
    const customerAgg = new Map<string, { amount: Decimal; count: number }>();

    for (const inv of finalized) {
      const snap = inv.snapshot!;
      const grand = snap.totals.grand_total;
      const tax = snap.totals.total_cgst.plus(snap.totals.total_sgst).plus(snap.totals.total_igst);
      totalSales = totalSales.plus(grand);
      totalTax = totalTax.plus(tax);

      const key = monthKey(inv.invoice_date);
      if (key) {
        const entry = monthMap.get(key) ?? { count: 0, amount: new Money(0) };
        entry.count += 1;
        entry.amount = entry.amount.plus(grand);
        monthMap.set(key, entry);
      }
      if (key === thisMonthKey) {
        salesThisMonth = salesThisMonth.plus(grand);
        taxThisMonth = taxThisMonth.plus(tax);
        invoicesThisMonth += 1;
      }

      // Receivables by payment status.
      if (inv.payment_status === PaymentStatus.UNPAID) {
        receivablesTotal = receivablesTotal.plus(grand);
        receivablesUnpaid = receivablesUnpaid.plus(grand);
      } else if (inv.payment_status === PaymentStatus.PARTIAL) {
        receivablesTotal = receivablesTotal.plus(grand);
        receivablesPartial = receivablesPartial.plus(grand);
      }

      // Top customers (by billed grand total).
      const custName = snap.customer.name || 'Unknown';
      const c = customerAgg.get(custName) ?? { amount: new Money(0), count: 0 };
      c.amount = c.amount.plus(grand);
      c.count += 1;
      customerAgg.set(custName, c);

      // Best/least selling: aggregate by line description (product name).
      for (const line of snap.lines) {
        const name = line.description.trim() || '(unnamed)';
        const p = productAgg.get(name) ?? { qty: new Money(0), amount: new Money(0) };
        p.qty = p.qty.plus(line.quantity);
        p.amount = p.amount.plus(line.taxable_amount ?? new Money(0));
        productAgg.set(name, p);
      }
    }

    // --- Monthly series: a contiguous window ending at the current month ---
    const months: MonthPoint[] = [];
    for (let i = this.monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthMap.get(key);
      months.push({
        key,
        label: monthLabel(key),
        sales_count: entry?.count ?? 0,
        sales_amount: (entry?.amount ?? new Money(0)).toFixed(2),
      });
    }

    // --- Product rankings ---
    const ranked = [...productAgg.entries()]
      .map(([name, v]) => ({ name, qty: v.qty, quantity: v.qty.toString(), amount: v.amount.toFixed(2) }))
      .sort((a, b) => b.qty.comparedTo(a.qty));
    const toRank = ({ name, quantity, amount }: { name: string; quantity: string; amount: string }): ProductRank => ({
      name,
      quantity,
      amount,
    });
    const bestSelling: ProductRank[] = ranked.slice(0, 5).map(toRank);
    const leastSelling: ProductRank[] = [...ranked]
      .sort((a, b) => a.qty.comparedTo(b.qty))
      .slice(0, 5)
      .map(toRank);

    // --- Low stock: uses LIVE current stock (Σ movement deltas), matching the
    // Manage Stock screen — NOT the static opening_qty master field. ---
    const stockMap = this.stock.currentStockMap();
    const zero = new Money(0);
    const lowAll = this.products
      .list({})
      .filter((p) => tracksStock(p.item_type) && p.low_stock_alert !== null)
      .map((p) => ({ p, current: stockMap.get(p.id) ?? zero }))
      .filter(({ p, current }) => current.lessThanOrEqualTo(p.low_stock_alert!));
    const lowStock: LowStockItem[] = lowAll.slice(0, 10).map(({ p, current }) => ({
      name: p.name,
      available: current.toString(),
      threshold: p.low_stock_alert!.toString(),
      unit: p.unit_of_measurement,
    }));
    const lowStockTotal = lowAll.length;

    // --- Top customers ---
    const topCustomers: NamedAmount[] = [...customerAgg.entries()]
      .map(([name, v]) => ({ name, amount: v.amount, count: v.count }))
      .sort((a, b) => b.amount.comparedTo(a.amount))
      .slice(0, 5)
      .map((c) => ({ name: c.name, amount: c.amount.toFixed(2), count: c.count }));

    return {
      kpi: {
        sales_this_month: salesThisMonth.toFixed(2),
        tax_this_month: taxThisMonth.toFixed(2),
        invoices_this_month: invoicesThisMonth,
        total_sales: totalSales.toFixed(2),
        total_tax: totalTax.toFixed(2),
        finalized_count: finalized.length,
        receivables_total: receivablesTotal.toFixed(2),
        receivables_unpaid: receivablesUnpaid.toFixed(2),
        receivables_partial: receivablesPartial.toFixed(2),
      },
      months,
      best_selling: bestSelling,
      least_selling: leastSelling,
      low_stock: lowStock,
      low_stock_total: lowStockTotal,
      top_customers: topCustomers,
      has_data: finalized.length > 0 || lowStockTotal > 0,
    };
  }
}
