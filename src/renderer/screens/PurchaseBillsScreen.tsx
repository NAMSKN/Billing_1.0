import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Wand2, Eye } from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { Button, Card, Input, Select } from '../components/ui';
import { StatusBadge, PaymentBadge } from '../components/badges';
import { rupees, formatDate } from '../lib/format';
import { BillOcrModal } from './BillOcrModal';
import { ParsedBill, CatalogProduct } from '../../shared/domain/purchaseOcr';

export const PurchaseBillsScreen: React.FC<{
  onOpenPurchase: (id: string) => void;
  onNewPurchase: () => void;
}> = ({ onOpenPurchase, onNewPurchase }) => {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [isOcrOpen, setIsOcrOpen] = useState<boolean>(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [invRes, prodRes] = await Promise.all([
        window.api.invoices.listSummaries({}),
        window.api.products.list({}),
      ]);

      if (invRes.ok) {
        // Filter strictly for PURCHASE bills (kind: PURCHASE)
        const purchases = (invRes.data as any[]).filter(
          (i) => (i.kind || i.type || '').toUpperCase() === 'PURCHASE',
        );
        setInvoices(purchases);
      }

      if (prodRes.ok) {
        const prods = ((prodRes.data as any).items || []).map((p: any) => ({
          id: p.id,
          name: p.name,
          hsn: p.hsn,
          taxPercent: p.tax_percent ?? p.taxPercent,
        }));
        setCatalog(prods);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const filteredPurchases = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesNum = (inv.invoice_number || '').toLowerCase().includes(q);
        const matchesParty = (inv.party_name || '').toLowerCase().includes(q);
        if (!matchesNum && !matchesParty) return false;
      }
      return true;
    });
  }, [invoices, statusFilter, search]);

  const summary = useMemo(() => {
    let totalPurchasesPaise = 0;
    let totalTaxPaise = 0;
    let unpaidPaise = 0;

    for (const inv of invoices) {
      totalPurchasesPaise += Number(inv.total_paise ?? 0);
      totalTaxPaise += Number(inv.tax_paise ?? 0);
      const bal = Number(inv.balance_paise ?? inv.outstanding_paise ?? 0);
      unpaidPaise += bal;
    }

    return {
      count: invoices.length,
      totalPurchases: totalPurchasesPaise / 100,
      totalTax: totalTaxPaise / 100,
      unpaid: unpaidPaise / 100,
    };
  }, [invoices]);

  const handleApplyOcr = async (parsed: ParsedBill) => {
    // 1. Create a new purchase bill draft via API
    try {
      const draftRes = await window.api.invoices.createDraft('PURCHASE');
      if (!draftRes.ok) {
        alert(draftRes.error.message);
        return;
      }

      const draft = draftRes.data as any;

      // 2. Map OCR lines to invoice line items
      const lines = parsed.items.map((it) => ({
        id: crypto.randomUUID(),
        name: it.name,
        hsn: it.hsn,
        quantity: it.quantity,
        unit: 'PCS',
        rate_paise: Math.round(it.rate * 100),
        tax_rate: it.taxPercent,
        product_id: it.matchedProductId || null,
      }));

      // 3. Save draft with populated OCR header & items
      const patch = {
        id: draft.id,
        invoice_number: parsed.invoiceNumber || draft.invoice_number,
        invoice_date: parsed.date || new Date().toISOString().slice(0, 10),
        party_name: parsed.supplierName,
        party_gstin: parsed.supplierGstin,
        lines: lines.length > 0 ? lines : draft.lines,
      };

      await window.api.invoices.saveDraft(patch);
      onOpenPurchase(draft.id);
    } catch (err: any) {
      alert('Error creating purchase draft: ' + err.message);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <PageHeader
        title="Inward Purchase Bills"
        description="Record supplier raw materials, tooling costs, and auto-extract via Offline Bill OCR"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setIsOcrOpen(true)}>
              <Wand2 className="h-4 w-4 mr-1.5" /> Scan Bill (OCR)
            </Button>
            <Button variant="primary" onClick={onNewPurchase}>
              <Plus className="h-4 w-4 mr-1.5" /> New Purchase Bill
            </Button>
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total Inward Purchases
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground">
            {rupees(summary.totalPurchases)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">{summary.count} Bills Recorded</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            ITC Eligible Tax
          </div>
          <div className="text-2xl font-bold mt-2 text-emerald-600">
            {rupees(summary.totalTax)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">GSTR-3B Table 4(A) ITC</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Accounts Payable (Owed)
          </div>
          <div className="text-2xl font-bold mt-2 text-rose-600">
            {rupees(summary.unpaid)}
          </div>
          <div className="text-xs text-muted-foreground mt-1">Pending vendor settlements</div>
        </Card>

        <Card className="p-5">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Fast Entry Mode
          </div>
          <div className="text-sm font-semibold mt-2 text-accent flex items-center gap-1.5">
            <Wand2 className="h-4 w-4" /> AI Offline OCR Active
          </div>
          <div className="text-xs text-muted-foreground mt-1">Zero cloud latency & private</div>
        </Card>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-surface p-4 rounded-lg border border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground">Status:</span>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40"
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="FINALIZED">Finalized</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </div>

        <div className="w-72">
          <Input
            type="text"
            placeholder="Search supplier, bill no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Purchases List Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
              <tr>
                <th className="py-3 px-4">Bill No.</th>
                <th className="py-3 px-4">Supplier</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Payment</th>
                <th className="py-3 px-4 text-right">Tax (ITC)</th>
                <th className="py-3 px-4 text-right">Total Amount</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    Loading purchase records...
                  </td>
                </tr>
              ) : filteredPurchases.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    No inward purchase bills found. Use "+ New Purchase Bill" or "Scan Bill (OCR)".
                  </td>
                </tr>
              ) : (
                filteredPurchases.map((inv) => (
                  <tr key={inv.id} className="hover:bg-muted/40 transition-colors">
                    <td className="py-3 px-4 font-mono font-medium text-foreground">
                      {inv.invoice_number || 'Draft'}
                    </td>
                    <td className="py-3 px-4 font-medium text-foreground">
                      {inv.party_name || 'Unknown Supplier'}
                    </td>
                    <td className="py-3 px-4 text-muted-foreground text-xs whitespace-nowrap">
                      {formatDate(inv.invoice_date)}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={inv.status} />
                    </td>
                    <td className="py-3 px-4">
                      <PaymentBadge status={inv.payment_status} />
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-emerald-600 text-xs">
                      {rupees((Number(inv.tax_paise ?? 0)) / 100)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold text-foreground">
                      {rupees((Number(inv.total_paise ?? 0)) / 100)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onOpenPurchase(inv.id)}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" /> Open
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Bill OCR Modal */}
      {isOcrOpen && (
        <BillOcrModal
          catalog={catalog}
          onClose={() => setIsOcrOpen(false)}
          onApply={handleApplyOcr}
        />
      )}
    </div>
  );
};
