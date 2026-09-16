import { useEffect, useMemo, useState } from 'react';
import { FileText, Search, Copy, Ban, Eye } from 'lucide-react';
import type { InvoiceDto } from '@shared/dto';
import { InvoiceStatus } from '@shared/domain/enums';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate } from '../lib/format';
import { Button, Card, Input, Select, EmptyState } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, PaymentBadge } from '../components/badges';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export function InvoiceHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [cancelling, setCancelling] = useState<InvoiceDto | null>(null);

  const load = async () => setInvoices(await unwrap(window.api.invoices.listSummaries()));

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      invoices.filter((i) => {
        const matchesQuery =
          !query ||
          (i.invoice_number ?? '').toLowerCase().includes(query.toLowerCase());
        const matchesStatus = statusFilter === 'ALL' || i.status === statusFilter;
        return matchesQuery && matchesStatus;
      }),
    [invoices, query, statusFilter],
  );

  const duplicate = async (inv: InvoiceDto) => {
    try {
      const dup = await unwrap<InvoiceDto>(window.api.invoices.duplicate(inv.id));
      toast.success('Duplicated into a new draft');
      onOpen(dup.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate');
    }
  };

  return (
    <div>
      <PageHeader title="Invoices" description="Search, filter, view, duplicate, or cancel invoices." />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by invoice number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select className="w-44" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          <option value={InvoiceStatus.DRAFT}>Draft</option>
          <option value={InvoiceStatus.FINALIZED}>Finalized</option>
          <option value={InvoiceStatus.CANCELLED}>Cancelled</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No invoices found"
          description="Adjust your search or create a new invoice."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Payment</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((inv) => (
                <tr key={inv.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium">{inv.invoice_number ?? 'Draft'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(inv.invoice_date)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-5 py-3">
                    {inv.status === InvoiceStatus.DRAFT ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <PaymentBadge status={inv.payment_status} />
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {inv.totals ? rupees(inv.totals.grand_total) : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onOpen(inv.id)}>
                        <Eye className="h-3.5 w-3.5" /> Open
                      </Button>
                      {inv.status === InvoiceStatus.FINALIZED && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => void duplicate(inv)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setCancelling(inv)}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {cancelling && (
        <CancelModal
          invoice={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            void load();
            toast.info('Invoice cancelled');
          }}
        />
      )}
    </div>
  );
}

function CancelModal({
  invoice,
  onClose,
  onCancelled,
}: {
  invoice: InvoiceDto;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!reason.trim()) {
      toast.error('A cancellation reason is required');
      return;
    }
    setBusy(true);
    try {
      await unwrap(window.api.invoices.cancel({ id: invoice.id, reason }));
      onCancelled();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${invoice.invoice_number ?? 'invoice'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep invoice
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel Invoice'}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Cancelling preserves the record and its number — it is never reused. This cannot be undone.
      </p>
      <Input
        placeholder="Reason for cancellation"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        autoFocus
      />
    </Modal>
  );
}
