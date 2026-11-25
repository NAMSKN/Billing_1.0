import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Input, Select } from '../components/ui';
import { rupees } from '../lib/format';
import {
  CashEntry,
  CashLine,
  CASH_CATEGORIES,
  cashBookView,
  cashSummary,
  validateCashEntry,
} from '../../shared/domain/cashBook';

export const CashBookScreen: React.FC = () => {
  const [entries, setEntries] = useState<CashEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'today' | 'this_month'>('this_month');

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [formType, setFormType] = useState<'in' | 'out'>('in');
  const [formAmount, setFormAmount] = useState<string>('');
  const [formDate, setFormDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [formName, setFormName] = useState<string>('');
  const [formCategory, setFormCategory] = useState<string>(CASH_CATEGORIES[0]);
  const [formNote, setFormNote] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await window.api.cashBook.list();
      if (res.ok) {
        // Map DB rows to domain CashEntry
        const items: CashEntry[] = (res.data || []).map((r: any) => ({
          id: r.id,
          type: r.type,
          amount: (r.amount_paise ?? 0) / 100,
          date: r.entry_date ?? '',
          name: r.name ?? '',
          note: r.note ?? '',
          category: r.category ?? '',
          createdAt: r.created_at ?? '',
        }));
        setEntries(items);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const thisMonthStr = useMemo(() => new Date().toISOString().slice(0, 7), []);

  const cashLines: CashLine[] = useMemo(() => {
    return entries.map((e) => ({
      key: e.id,
      source: 'own',
      label: e.name,
      type: e.type,
      date: e.date,
      amount: e.amount,
      name: e.name,
      note: e.note,
      category: e.category,
    }));
  }, [entries]);

  const viewOptions = useMemo(() => {
    if (filterPeriod === 'today') {
      return { from: todayStr, to: todayStr, search };
    }
    if (filterPeriod === 'this_month') {
      return { from: `${thisMonthStr}-01`, search };
    }
    return { search };
  }, [filterPeriod, todayStr, thisMonthStr, search]);

  const bookView = useMemo(() => {
    return cashBookView(cashLines, viewOptions);
  }, [cashLines, viewOptions]);

  const summary = useMemo(() => {
    return cashSummary(cashLines, todayStr);
  }, [cashLines, todayStr]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountVal = parseFloat(formAmount);
    const newEntry: CashEntry = {
      id: crypto.randomUUID(),
      type: formType,
      amount: amountVal,
      date: formDate,
      name: formName.trim() || 'General Cash',
      note: formNote.trim(),
      category: formCategory,
      createdAt: new Date().toISOString(),
    };

    const err = validateCashEntry(newEntry);
    if (err) {
      alert(err);
      return;
    }

    setSubmitting(true);
    try {
      const res = await window.api.cashBook.save({
        id: newEntry.id,
        type: newEntry.type,
        amount_paise: Math.round(newEntry.amount * 100),
        entry_date: newEntry.date,
        name: newEntry.name,
        note: newEntry.note,
        category: newEntry.category,
        created_at: newEntry.createdAt,
      });

      if (res.ok) {
        setIsModalOpen(false);
        setFormAmount('');
        setFormName('');
        setFormNote('');
        loadData();
      } else {
        alert(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this cash entry?')) return;
    const res = await window.api.cashBook.delete(id);
    if (res.ok) {
      loadData();
    } else {
      alert(res.error.message);
    }
  };

  const handleExportCsv = () => {
    const header = ['Date', 'Type', 'Party/Particulars', 'Category', 'Amount', 'Balance', 'Note'];
    const rows = bookView.rows.map((r) => [
      r.date,
      r.type.toUpperCase(),
      `"${(r.name || '').replace(/"/g, '""')}"`,
      `"${(r.category || '').replace(/"/g, '""')}"`,
      r.amount,
      r.balance ?? '',
      `"${(r.note || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `CashBook_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Cash Book (Roznamcha)"
        description="Daily petty cash tracking, payments in/out, and live running balance"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleExportCsv}>
              Export CSV
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setFormType('in');
                setIsModalOpen(true);
              }}
            >
              + Cash In / Out
            </Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Net Cash in Hand
          </div>
          <div
            className={`text-2xl font-bold mt-2 ${
              summary.inHand >= 0 ? 'text-emerald-600' : 'text-rose-600'
            }`}
          >
            {rupees(summary.inHand)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Live workshop cash balance</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Today In / Out
          </div>
          <div className="text-lg font-bold mt-2 text-foreground">
            <span className="text-emerald-600">+{rupees(summary.today.in)}</span>
            {' / '}
            <span className="text-rose-600">-{rupees(summary.today.out)}</span>
          </div>
          <div className="text-xs text-muted-foreground mt-1">Activity for {todayStr}</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Month In
          </div>
          <div className="text-2xl font-bold mt-2 text-emerald-600">
            +{rupees(summary.month.in)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Collections this month</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Month Out
          </div>
          <div className="text-2xl font-bold mt-2 text-rose-600">
            -{rupees(summary.month.out)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Expenses/petty cash this month</div>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-4 rounded-lg border border-border">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Period:</span>
          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => setFilterPeriod('this_month')}
              className={`px-3 py-1.5 text-xs font-medium rounded-l-md border ${
                filterPeriod === 'this_month'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              This Month
            </button>
            <button
              onClick={() => setFilterPeriod('today')}
              className={`px-3 py-1.5 text-xs font-medium border-t border-b ${
                filterPeriod === 'today'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setFilterPeriod('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-r-md border ${
                filterPeriod === 'all'
                  ? 'bg-accent/15 text-accent border-accent'
                  : 'bg-surface text-foreground border-border hover:bg-muted'
              }`}
            >
              All Time
            </button>
          </div>
        </div>

        <div className="w-72">
          <Input
            type="text"
            placeholder="Search party, category, or notes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Ledger Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Particulars / Party</th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Cash In (+)</th>
                <th className="py-3 px-4 text-right">Cash Out (-)</th>
                <th className="py-3 px-4 text-right">Running Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading cash entries...
                  </td>
                </tr>
              ) : bookView.rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    No cash entries found for this selection.
                  </td>
                </tr>
              ) : (
                bookView.rows.map((row) => (
                  <tr key={row.key} className="hover:bg-muted/40">
                    <td className="py-3 px-4 text-muted-foreground whitespace-nowrap">{row.date}</td>
                    <td className="py-3 px-4">
                      <div className="font-medium text-foreground">{row.name}</div>
                      {row.note && <div className="text-xs text-muted-foreground">{row.note}</div>}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block px-2 py-0.5 text-xs bg-muted text-muted-foreground rounded">
                        {row.category}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-emerald-600">
                      {row.type === 'in' ? rupees(row.amount) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-rose-600">
                      {row.type === 'out' ? rupees(row.amount) : '-'}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-bold ${
                        (row.balance ?? 0) >= 0 ? 'text-foreground' : 'text-rose-600'
                      }`}
                    >
                      {row.balance !== undefined ? rupees(row.balance) : '-'}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleDelete(row.key)}
                        className="text-muted-foreground hover:text-danger text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Record Cash In/Out Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground">Record Cash Entry</h3>

            {/* Type selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setFormType('in')}
                className={`py-2 text-sm font-semibold rounded-md border ${
                  formType === 'in'
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500 ring-2 ring-emerald-500/20'
                    : 'bg-surface text-muted-foreground border-border'
                }`}
              >
                + Cash In (Receipt)
              </button>
              <button
                type="button"
                onClick={() => setFormType('out')}
                className={`py-2 text-sm font-semibold rounded-md border ${
                  formType === 'out'
                    ? 'bg-rose-500/10 text-rose-600 border-rose-500 ring-2 ring-rose-500/20'
                    : 'bg-surface text-muted-foreground border-border'
                }`}
              >
                - Cash Out (Payment)
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Amount (₹) *
                </label>
                <Input
                  type="number"
                  step="0.01"
                  required
                  autoFocus
                  placeholder="0.00"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  className="text-lg font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Date *
                  </label>
                  <Input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                    Category
                  </label>
                  <Select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                  >
                    {CASH_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Party / Person Name
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Ramesh Hardware, Tea vendor, etc."
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Remarks / Note
                </label>
                <Input
                  placeholder="Reason, voucher ref, etc."
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save Cash Entry'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
