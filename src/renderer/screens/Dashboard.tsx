import { useEffect, useState } from 'react';
import {
  FileText,
  IndianRupee,
  ReceiptText,
  TriangleAlert,
  Plus,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Users,
} from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import type { DashboardReport } from '@shared/reportDto';
import { unwrap } from '../lib/api';
import { rupees, formatMoneyString } from '../lib/format';
import { Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import type { Route } from '../App';

const ACCENT = '#4f46e5';
const MUTED = '#94a3b8';

/**
 * Dashboard: KPI cards + charts + analytics panels, all computed on the main
 * process from persisted invoices and product stock (nothing hardcoded). Empty
 * states render gracefully until real data exists.
 */
export function Dashboard({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const [report, setReport] = useState<DashboardReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setReport(await unwrap<DashboardReport>(window.api.dashboard.report()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading || !report) {
    return (
      <div>
        <PageHeader title="Dashboard" description="Your billing at a glance." />
        <div className="grid grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <CardBody>
                <div className="h-16 animate-pulse rounded bg-muted" />
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const k = report.kpi;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live analytics from your finalized invoices and catalogue."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button onClick={() => onNavigate({ name: 'invoice', id: 'new' })}>
              <Plus className="h-4 w-4" /> New Invoice
            </Button>
          </div>
        }
      />

      {!report.has_data ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No analytics yet"
          description="Finalize an invoice or add products with stock, and this dashboard fills in automatically."
          action={
            <Button onClick={() => onNavigate({ name: 'invoice', id: 'new' })}>
              <Plus className="h-4 w-4" /> Create your first invoice
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-4">
            <KpiCard
              icon={<IndianRupee className="h-5 w-5" />}
              label="Sales this month"
              value={rupees(k.sales_this_month)}
              sub={`+GST ${formatMoneyString(k.tax_this_month)}`}
              spark={report.months.map((m) => Number(m.sales_amount))}
            />
            <KpiCard
              icon={<FileText className="h-5 w-5" />}
              label="Invoices this month"
              value={String(k.invoices_this_month)}
              sub={`${k.finalized_count} finalized all-time`}
            />
            <KpiCard
              icon={<ReceiptText className="h-5 w-5" />}
              label="Total sales"
              value={rupees(k.total_sales)}
              sub={`Tax ${formatMoneyString(k.total_tax)}`}
            />
            <KpiCard
              icon={<TriangleAlert className="h-5 w-5" />}
              label="Receivables"
              value={rupees(k.receivables_total)}
              sub={`Unpaid ${formatMoneyString(k.receivables_unpaid)} · Partial ${formatMoneyString(k.receivables_partial)}`}
              tone={Number(k.receivables_total) > 0 ? 'warning' : 'neutral'}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Invoice Count — last 6 months</CardTitle>
              </CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={report.months} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} width={28} />
                    <Tooltip
                      cursor={{ fill: 'hsl(var(--muted))' }}
                      contentStyle={tooltipStyle}
                      formatter={(v) => [`${Number(v)} invoice(s)`, 'Sales']}
                    />
                    <Bar dataKey="sales_count" name="Invoices" fill={ACCENT} radius={[4, 4, 0, 0]} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sales Amount — last 6 months</CardTitle>
              </CardHeader>
              <CardBody>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart
                    data={report.months.map((m) => ({ ...m, amount: Number(m.sales_amount) }))}
                    margin={{ top: 8, right: 12, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: MUTED }} tickLine={false} axisLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: MUTED }}
                      tickLine={false}
                      axisLine={false}
                      width={52}
                      tickFormatter={(v: number) => `₹${compact(v)}`}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [rupees(Number(v).toFixed(2)), 'Sales']}
                    />
                    <Line
                      type="monotone"
                      dataKey="amount"
                      name="Sales"
                      stroke={ACCENT}
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: ACCENT }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          </div>

          {/* Product analytics */}
          <div className="grid grid-cols-3 gap-6">
            <RankPanel
              title="Best Selling"
              icon={<TrendingUp className="h-4 w-4 text-success" />}
              rows={report.best_selling.map((p) => ({ name: p.name, value: `${p.quantity}` }))}
              empty="No sales yet"
            />
            <RankPanel
              title="Least Selling"
              icon={<TrendingDown className="h-4 w-4 text-muted-foreground" />}
              rows={report.least_selling.map((p) => ({ name: p.name, value: `${p.quantity}` }))}
              empty="No sales yet"
            />
            <RankPanel
              title="Low Stock"
              icon={<TriangleAlert className="h-4 w-4 text-warning" />}
              rows={report.low_stock.map((p) => ({
                name: p.name,
                value: `${p.available} ${p.unit}`,
                danger: true,
              }))}
              empty="All stock healthy"
              footer={
                report.low_stock_total > report.low_stock.length
                  ? `+${report.low_stock_total - report.low_stock.length} more low-stock item(s)`
                  : undefined
              }
            />
          </div>

          {/* Top customers */}
          <Card>
            <CardHeader>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-accent" /> Top Customers
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {report.top_customers.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted-foreground">No customer sales yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {report.top_customers.map((c) => (
                    <li key={c.name} className="flex items-center justify-between px-5 py-3">
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.count} invoice(s)</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{rupees(c.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

const tooltipStyle: React.CSSProperties = {
  borderRadius: 8,
  border: '1px solid hsl(var(--border))',
  background: 'hsl(var(--surface))',
  fontSize: 12,
  color: 'hsl(var(--foreground))',
};

/** Compact large rupee values for axis labels: 60000 -> "60K", 240000 -> "2.4L". */
function compact(v: number): string {
  if (v >= 10000000) return `${(v / 10000000).toFixed(1)}Cr`;
  if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
  if (v >= 1000) return `${Math.round(v / 1000)}K`;
  return String(v);
}

function KpiCard({
  icon,
  label,
  value,
  sub,
  spark,
  tone = 'accent',
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  spark?: number[];
  tone?: 'accent' | 'warning' | 'neutral';
}) {
  const toneClass =
    tone === 'warning'
      ? 'bg-warning/12 text-warning'
      : tone === 'neutral'
        ? 'bg-muted text-muted-foreground'
        : 'bg-accent/12 text-accent';
  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex items-center justify-between">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${toneClass}`}>{icon}</div>
          {spark && spark.some((n) => n > 0) && <MiniBars data={spark} />}
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xl font-semibold tabular-nums">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardBody>
    </Card>
  );
}

/** Tiny inline sparkline bars for a KPI card. */
function MiniBars({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-8 items-end gap-0.5">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-1.5 rounded-sm bg-accent/50"
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function RankPanel({
  title,
  icon,
  rows,
  empty,
  footer,
}: {
  title: string;
  icon: React.ReactNode;
  rows: { name: string; value: string; danger?: boolean }[];
  empty: string;
  footer?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <span className="flex items-center gap-2">
            {icon} {title}
          </span>
        </CardTitle>
      </CardHeader>
      <CardBody className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r, i) => (
              <li key={`${r.name}-${i}`} className="flex items-center justify-between px-5 py-2.5">
                <span className="truncate pr-2 text-sm" title={r.name}>
                  {r.name}
                </span>
                {r.danger ? (
                  <Badge tone="warning">{r.value}</Badge>
                ) : (
                  <span className="shrink-0 text-sm font-medium tabular-nums text-muted-foreground">{r.value}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {footer && rows.length > 0 && (
          <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">{footer}</p>
        )}
      </CardBody>
    </Card>
  );
}
