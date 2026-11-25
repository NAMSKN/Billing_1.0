import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Input } from '../components/ui';
import { rupees } from '../lib/format';
import {
  CostCentre,
  CostCentreReportResult,
  costCentreReport,
} from '../../shared/domain/costCentres';

export const CostCentresScreen: React.FC = () => {
  const [costCentres, setCostCentres] = useState<CostCentre[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // New cost centre modal
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formCode, setFormCode] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ccRes, invRes] = await Promise.all([
        window.api.costCentres.list(),
        window.api.invoices.listSummaries({}),
      ]);

      if (ccRes.ok) {
        const centres: CostCentre[] = (ccRes.data || []).map((r: any) => ({
          id: r.id,
          name: r.name,
          code: r.code,
          isArchived: !r.active,
          createdAt: r.created_at,
        }));
        setCostCentres(centres);
      }
      if (invRes.ok) {
        setInvoices(invRes.data as any[]);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      alert('Name is required.');
      return;
    }

    const id = crypto.randomUUID();
    const code = formCode.trim().toUpperCase() || formName.trim().slice(0, 4).toUpperCase();

    setSubmitting(true);
    try {
      const res = await window.api.costCentres.save({
        id,
        name: formName.trim(),
        code,
        description: '',
        active: 1,
        created_at: new Date().toISOString(),
      });
      if (res.ok) {
        setIsModalOpen(false);
        setFormName('');
        setFormCode('');
        loadData();
      } else {
        alert(res.error.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Archive this cost centre?')) return;
    const res = await window.api.costCentres.archive(id);
    if (res.ok) {
      loadData();
    } else {
      alert(res.error.message);
    }
  };

  // Convert invoices to bills and purchases for costCentreReport
  const reportData: CostCentreReportResult = useMemo(() => {
    const saleBills: Array<{
      costCentreId?: string | null;
      taxable: number;
      tax: number;
      total: number;
      date: string;
    }> = [];

    const purchaseBills: Array<{
      costCentreId?: string | null;
      taxable: number;
      date: string;
    }> = [];

    for (const inv of invoices) {
      const isPurchase = (inv.kind || inv.type || '').toUpperCase() === 'PURCHASE';
      const taxable = Number(inv.taxable_paise ?? 0) / 100;
      const tax = Number(inv.tax_paise ?? 0) / 100;
      const total = Number(inv.total_paise ?? 0) / 100;
      const date = inv.issue_date || inv.date || '';
      const costCentreId = inv.cost_centre_id || inv.costCentreId;

      if (isPurchase) {
        purchaseBills.push({ costCentreId, taxable, date });
      } else {
        saleBills.push({ costCentreId, taxable, tax, total, date });
      }
    }

    return costCentreReport({
      centres: costCentres,
      bills: saleBills,
      purchases: purchaseBills,
    });
  }, [costCentres, invoices]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Cost Centres & Machine Profitability"
        description="Track revenue, direct purchases, expenses, and net profit per CNC Machine, Mould Project, or Line"
        actions={
          <Button variant="primary" onClick={() => setIsModalOpen(true)}>
            + New Cost Centre
          </Button>
        }
      />

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Machine Revenue (Taxable)
          </div>
          <div className="text-2xl font-bold mt-2 text-emerald-600">
            {rupees(reportData.total.salesTaxable)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Total with Tax: {rupees(reportData.total.salesTotal)}
          </div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Allocated Direct Costs
          </div>
          <div className="text-2xl font-bold mt-2 text-rose-600">
            {rupees(reportData.total.purchases + reportData.total.expenses)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Purchases & direct job expenses</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Net Machine Profit / Contribution
          </div>
          <div
            className={`text-2xl font-bold mt-2 ${
              reportData.total.profit >= 0 ? 'text-accent' : 'text-rose-600'
            }`}
          >
            {rupees(reportData.total.profit)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Operating margin contribution</div>
        </Card>
      </div>

      {/* Cost Centre Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Cost Centre / Machine</th>
                <th className="py-3 px-4 text-center">Documents</th>
                <th className="py-3 px-4 text-right">Sales (Taxable)</th>
                <th className="py-3 px-4 text-right">Direct Costs</th>
                <th className="py-3 px-4 text-right">Net Profit</th>
                <th className="py-3 px-4 text-center">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading cost centres...
                  </td>
                </tr>
              ) : reportData.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    No cost centres created yet. Click "+ New Cost Centre" to track machine or project
                    profitability.
                  </td>
                </tr>
              ) : (
                reportData.rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/40">
                    <td className="py-3 px-4 font-mono font-bold text-foreground">
                      {row.code}
                    </td>
                    <td className="py-3 px-4 font-semibold text-foreground">{row.name}</td>
                    <td className="py-3 px-4 text-center text-muted-foreground text-xs">
                      {row.documentCount}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-emerald-600 font-mono text-xs">
                      {rupees(row.salesTaxable)}
                    </td>
                    <td className="py-3 px-4 text-right font-medium text-rose-600 font-mono text-xs">
                      {rupees(row.purchases + row.expenses)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-bold font-mono text-xs ${
                        row.profit >= 0 ? 'text-foreground' : 'text-rose-600'
                      }`}
                    >
                      {rupees(row.profit)}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded font-medium ${
                          !row.isArchived
                            ? 'bg-emerald-500/10 text-emerald-600'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {!row.isArchived ? 'Active' : 'Archived'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {!row.isArchived && row.id !== '__untagged' ? (
                        <button
                          onClick={() => handleArchive(row.id)}
                          className="text-muted-foreground hover:text-danger text-xs font-medium"
                        >
                          Archive
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {reportData.rows.length > 0 && (
              <tfoot className="bg-muted/70 font-bold border-t-2 border-border text-foreground">
                <tr>
                  <td className="py-3 px-4" colSpan={2}>TOTALS</td>
                  <td className="py-3 px-4 text-center text-xs">{reportData.total.documentCount}</td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-emerald-600">
                    {rupees(reportData.total.salesTaxable)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-rose-600">
                    {rupees(reportData.total.purchases + reportData.total.expenses)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-xs text-accent">
                    {rupees(reportData.total.profit)}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* New Cost Centre Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold text-foreground">Add Cost Centre / Machine</h3>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Name / Identifier *
                </label>
                <Input
                  type="text"
                  required
                  autoFocus
                  placeholder="e.g. VMC 850, Gun Drilling, Lathe-02"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-muted-foreground uppercase mb-1">
                  Code (optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. VMC1, GUNDR, LAT02"
                  value={formCode}
                  onChange={(e) => setFormCode(e.target.value)}
                  className="font-mono uppercase"
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
                  {submitting ? 'Creating...' : 'Create Cost Centre'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
