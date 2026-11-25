import { useEffect, useMemo, useState } from 'react';
import { Wallet, Search, Ban, Eye, Trash2, Plus, Printer, Copy } from 'lucide-react';
import type { PaymentDto } from '@shared/paymentDto';
import {
  VoucherDirection,
  VOUCHER_DIRECTION_LABEL,
  PAYMENT_MODE_LABEL,
} from '@shared/domain/payment';
import { InvoiceStatus } from '@shared/domain/enums';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate } from '../lib/format';
import { Button, Card, Input, Select, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { CopyButton } from '../components/CopyButton';

/** Voucher status badge (DRAFT/FINALIZED/CANCELLED). */
export function VoucherStatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === InvoiceStatus.FINALIZED) return <Badge tone="success">Finalized</Badge>;
  if (status === InvoiceStatus.CANCELLED) return <Badge tone="danger">Cancelled</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

/**
 * Receipt / Payment voucher list. `direction` fixes which kind this screen
 * shows (Receipts for money-in, Payments for money-out) so the two appear as
 * separate menu items but share one implementation.
 */
export function PaymentHistory({
  direction,
  onOpen,
  onNew,
}: {
  direction: VoucherDirection;
  onOpen: (id: string) => void;
  onNew: (direction: VoucherDirection) => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<PaymentDto[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const noun = VOUCHER_DIRECTION_LABEL[direction]; // "Receipt" / "Payment"

  const load = async () => setRows(await unwrap(window.api.payments.listSummaries()));

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      rows
        .filter((v) => v.direction === direction)
        .filter((v) => {
          const matchesQuery =
            !query ||
            (v.payment_number ?? '').toLowerCase().includes(query.toLowerCase()) ||
            v.party.name.toLowerCase().includes(query.toLowerCase());
          const matchesStatus = statusFilter === 'ALL' || v.status === statusFilter;
          return matchesQuery && matchesStatus;
        }),
    [rows, direction, query, statusFilter],
  );

  const deleteDraft = async (v: PaymentDto) => {
    if (!window.confirm(`Delete this draft ${noun.toLowerCase()}? This cannot be undone.`)) return;
    try {
      await unwrap(window.api.payments.deleteDraft(v.id));
      toast.info('Draft deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete draft');
    }
  };

  const cancel = async (v: PaymentDto) => {
    const reason = window.prompt(`Reason for cancelling this ${noun.toLowerCase()}?`);
    if (reason === null) return;
    try {
      await unwrap(window.api.payments.cancel({ id: v.id, reason }));
      toast.info(`${noun} cancelled`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  };

  const printPdf = async (v: PaymentDto) => {
    try {
      await unwrap(window.api.payments.pdfPreview(v.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to open PDF');
    }
  };

  const duplicate = async (v: PaymentDto) => {
    try {
      const dup = await unwrap<PaymentDto>(window.api.payments.duplicate(v.id));
      toast.success('Duplicated into a new draft');
      onOpen(dup.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate');
    }
  };

  return (
    <div>
      <PageHeader
        title={`${noun}s`}
        description={
          direction === VoucherDirection.RECEIPT
            ? 'Money received from customers. Allocate to sales / job work invoices, or record advances.'
            : 'Money paid to vendors. Allocate across one or more purchase invoices.'
        }
        actions={
          <Button onClick={() => onNew(direction)}>
            <Plus className="h-4 w-4" /> New {noun}
          </Button>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by number or party…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          <option value={InvoiceStatus.DRAFT}>Draft</option>
          <option value={InvoiceStatus.FINALIZED}>Finalized</option>
          <option value={InvoiceStatus.CANCELLED}>Cancelled</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-8 w-8" />}
          title={`No ${noun.toLowerCase()}s found`}
          description={`Create a ${noun.toLowerCase()} to record money ${
            direction === VoucherDirection.RECEIPT ? 'received' : 'paid'
          }.`}
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Party</th>
                <th className="px-5 py-3 font-medium">Mode</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Amount</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((v) => (
                <tr key={v.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium">
                    <div className="flex items-center gap-1.5">
                      <span>{v.payment_number ?? 'Draft'}</span>
                      {v.payment_number && <CopyButton text={v.payment_number} size={13} />}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(v.payment_date)}</td>
                  <td className="px-5 py-3 text-muted-foreground">{v.party.name || '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{PAYMENT_MODE_LABEL[v.mode]}</td>
                  <td className="px-5 py-3">
                    <VoucherStatusBadge status={v.status} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{rupees(v.amount)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onOpen(v.id)}>
                        <Eye className="h-3.5 w-3.5" /> Open
                      </Button>
                      {v.status === InvoiceStatus.FINALIZED && (
                        <Button variant="ghost" size="sm" onClick={() => void printPdf(v)}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void duplicate(v)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      {v.status === InvoiceStatus.DRAFT && (
                        <Button variant="ghost" size="sm" onClick={() => void deleteDraft(v)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {v.status !== InvoiceStatus.CANCELLED && (
                        <Button variant="ghost" size="sm" onClick={() => void cancel(v)}>
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
