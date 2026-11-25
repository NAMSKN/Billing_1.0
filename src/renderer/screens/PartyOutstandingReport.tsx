import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Input } from '../components/ui';
import { rupees } from '../lib/format';
import {
  periodMonths,
  buildPartyOutstanding,
  getFinancialYearStart,
  MonthColumn,
  PartyOutstandingRow,
  OutstandingEntry,
} from '../../shared/domain/partyOutstanding';

export const PartyOutstandingReportScreen: React.FC = () => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'receivable' | 'payable'>('receivable');
  const [mode, setMode] = useState<'fy' | 'calendar'>('fy');
  const [search, setSearch] = useState<string>('');

  const currentStartYear = useMemo(() => getFinancialYearStart(new Date()), []);
  const [startYear, setStartYear] = useState<number>(currentStartYear);

  const loadData = async () => {
    try {
      setLoading(true);
      const [invRes, partyRes] = await Promise.all([
        window.api.invoices.listSummaries({}),
        window.api.parties.list({}),
      ]);

      if (invRes.ok) {
        setInvoices(invRes.data as any[]);
      }
      if (partyRes.ok) {
        setParties((partyRes.data as any).items || []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const partyMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of parties) {
      map.set(p.id, p.name);
    }
    return map;
  }, [parties]);

  const outstandingEntries: OutstandingEntry[] = useMemo(() => {
    const items: OutstandingEntry[] = [];
    for (const inv of invoices) {
      const balPaise = Number(inv.balance_paise ?? inv.outstanding_paise ?? 0);
      if (balPaise <= 0) continue; // fully settled

      const isPurchase = (inv.kind || inv.type || '').toUpperCase() === 'PURCHASE';
      if (filterType === 'receivable' && isPurchase) continue;
      if (filterType === 'payable' && !isPurchase) continue;

      const partyId = inv.party_id || inv.customer_id || 'unknown';
      const partyName = inv.party_name || inv.customer_name || partyMap.get(partyId) || 'Unknown Party';

      items.push({
        partyName,
        invoiceDate: inv.issue_date || inv.date || '',
        dueAmount: balPaise / 100,
      });
    }
    return items;
  }, [invoices, partyMap, filterType]);

  const monthColumns: MonthColumn[] = useMemo(() => {
    return periodMonths(mode, startYear);
  }, [mode, startYear]);

  const rows: PartyOutstandingRow[] = useMemo(() => {
    const result = buildPartyOutstanding(outstandingEntries, monthColumns);
    if (!search.trim()) return result;
    const q = search.toLowerCase();
    return result.filter((r) => r.name.toLowerCase().includes(q));
  }, [outstandingEntries, monthColumns, search]);

  const columnTotals = useMemo(() => {
    let earlier = 0;
    const months: Record<string, number> = {};
    let grandTotal = 0;

    for (const m of monthColumns) {
      months[m.key] = 0;
    }

    for (const r of rows) {
      earlier += r.earlier;
      grandTotal += r.total;
      for (const m of monthColumns) {
        months[m.key] = (months[m.key] || 0) + (r.months[m.key] || 0);
      }
    }

    return { earlier, months, grandTotal };
  }, [rows, monthColumns]);

  const handleExportCsv = () => {
    const title = filterType === 'receivable' ? 'Receivables_Aging_Matrix' : 'Payables_Aging_Matrix';
    const header = ['Party Name', 'Earlier', ...monthColumns.map((m) => m.label), 'Total Outstanding'];
    const csvRows = rows.map((r) => [
      `"${r.name.replace(/"/g, '""')}"`,
      r.earlier,
      ...monthColumns.map((m) => r.months[m.key] || 0),
      r.total,
    ]);
    const csvContent = [header.join(','), ...csvRows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${title}_${mode}_${startYear}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Party Outstanding & Aging Matrix"
        description="Tally-style monthly horizontal matrix across the Financial Year"
        actions={
          <Button variant="secondary" onClick={handleExportCsv}>
            Export Matrix CSV
          </Button>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Outstanding
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground">
            {rupees(columnTotals.grandTotal)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{rows.length} Parties</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Earlier Unpaid
          </div>
          <div className="text-2xl font-bold mt-2 text-rose-600">
            {rupees(columnTotals.earlier)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Carried forward before period</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Year / Mode
          </div>
          <div className="text-lg font-bold mt-2 text-accent">
            {mode === 'fy' ? `FY ${startYear}-${String(startYear + 1).slice(-2)}` : `CY ${startYear}`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">12-month schedule</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Average per Party
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground">
            {rows.length > 0 ? rupees(columnTotals.grandTotal / rows.length) : rupees(0)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Across active accounts</div>
        </Card>
      </div>

      {/* Mode & Search Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-4 rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => setFilterType('receivable')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-l-md border ${
                filterType === 'receivable'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              Receivables (Customers)
            </button>
            <button
              onClick={() => setFilterType('payable')}
              className={`px-4 py-1.5 text-xs font-semibold rounded-r-md border ${
                filterType === 'payable'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              Payables (Vendors)
            </button>
          </div>

          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => setMode('fy')}
              className={`px-3 py-1.5 text-xs font-medium rounded-l-md border ${
                mode === 'fy'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              Financial Year
            </button>
            <button
              onClick={() => setMode('calendar')}
              className={`px-3 py-1.5 text-xs font-medium rounded-r-md border ${
                mode === 'calendar'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              Calendar Year
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setStartYear((y) => y - 1)}
              className="px-2 py-1 text-xs border border-border rounded hover:bg-muted text-foreground"
            >
              &larr; Prev
            </button>
            <span className="text-xs font-bold px-1 text-foreground">
              {mode === 'fy' ? `FY ${startYear}-${String(startYear + 1).slice(-2)}` : startYear}
            </span>
            <button
              onClick={() => setStartYear((y) => y + 1)}
              className="px-2 py-1 text-xs border border-border rounded hover:bg-muted text-foreground"
            >
              Next &rarr;
            </button>
          </div>
        </div>

        <div className="w-72">
          <Input
            type="text"
            placeholder="Search party name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Aging Matrix Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs whitespace-nowrap">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-2.5 px-3 sticky left-0 bg-surface z-10 min-w-48 shadow-sm">
                  Party Name
                </th>
                <th className="py-2.5 px-3 text-right text-rose-600">Earlier</th>
                {monthColumns.map((m) => (
                  <th key={m.key} className="py-2.5 px-3 text-right">
                    {m.label}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-right font-bold text-foreground bg-muted/40">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={monthColumns.length + 3} className="text-center py-8 text-muted-foreground">
                    Loading party aging matrix...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={monthColumns.length + 3} className="text-center py-8 text-muted-foreground">
                    No outstanding {filterType === 'receivable' ? 'receivables' : 'payables'} found!
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.name} className="hover:bg-muted/40">
                    <td className="py-2 px-3 font-semibold text-foreground sticky left-0 bg-surface z-10 shadow-sm">
                      {row.name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-rose-600">
                      {row.earlier > 0 ? rupees(row.earlier) : '-'}
                    </td>
                    {monthColumns.map((m) => {
                      const val = row.months[m.key] || 0;
                      return (
                        <td key={m.key} className="py-2 px-3 text-right font-mono text-foreground">
                          {val > 0 ? rupees(val) : '-'}
                        </td>
                      );
                    })}
                    <td className="py-2 px-3 text-right font-mono font-bold text-foreground bg-muted/20">
                      {rupees(row.total)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/70 font-bold border-t-2 border-border text-foreground">
                <tr>
                  <td className="py-2.5 px-3 sticky left-0 bg-muted z-10 shadow-sm">
                    TOTALS ({rows.length})
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono text-rose-600">
                    {rupees(columnTotals.earlier)}
                  </td>
                  {monthColumns.map((m) => (
                    <td key={m.key} className="py-2.5 px-3 text-right font-mono">
                      {rupees(columnTotals.months[m.key] || 0)}
                    </td>
                  ))}
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-accent bg-muted/90">
                    {rupees(columnTotals.grandTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>
    </div>
  );
};
