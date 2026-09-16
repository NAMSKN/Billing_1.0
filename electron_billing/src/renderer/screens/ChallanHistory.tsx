import { useEffect, useMemo, useState } from 'react';
import { Truck, Search, Copy, Ban, Eye, Trash2 } from 'lucide-react';
import type { ChallanDto } from '@shared/challanDto';
import { InvoiceStatus } from '@shared/domain/enums';
import { CHALLAN_DIRECTION_LABEL } from '@shared/domain/challan';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate } from '../lib/format';
import { Button, Card, Input, Select, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/badges';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export function ChallanHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const toast = useToast();
  const [challans, setChallans] = useState<ChallanDto[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [cancelling, setCancelling] = useState<ChallanDto | null>(null);

  const load = async () => setChallans(await unwrap(window.api.challans.listSummaries()));

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      challans.filter((c) => {
        const matchesQuery =
          !query ||
          (c.challan_number ?? '').toLowerCase().includes(query.toLowerCase()) ||
          c.party.name.toLowerCase().includes(query.toLowerCase());
        const matchesStatus = statusFilter === 'ALL' || c.status === statusFilter;
        return matchesQuery && matchesStatus;
      }),
    [challans, query, statusFilter],
  );

  const duplicate = async (c: ChallanDto) => {
    try {
      const dup = await unwrap<ChallanDto>(window.api.challans.duplicate(c.id));
      toast.success('Duplicated into a new draft');
      onOpen(dup.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate');
    }
  };

  const deleteDraft = async (c: ChallanDto) => {
    if (!window.confirm('Delete this draft challan? This cannot be undone.')) return;
    try {
      await unwrap(window.api.challans.deleteDraft(c.id));
      toast.info('Draft deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete draft');
    }
  };

  return (
    <div>
      <PageHeader
        title="Delivery Challans"
        description="Search, filter, view, duplicate, or cancel delivery challans."
      />

      <div className="mb-4 flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by challan number or party…"
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
          icon={<Truck className="h-8 w-8" />}
          title="No delivery challans found"
          description="Adjust your search or create a new challan."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Direction</th>
                <th className="px-5 py-3 font-medium">Party</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-3 font-medium">{c.challan_number ?? 'Draft'}</td>
                  <td className="px-5 py-3 text-muted-foreground">{formatDate(c.challan_date)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={c.direction === 'OUTWARD' ? 'accent' : 'neutral'}>
                      {CHALLAN_DIRECTION_LABEL[c.direction]}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{c.party.name || '—'}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {c.totals ? rupees(c.totals.grand_total) : '—'}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onOpen(c.id)}>
                        <Eye className="h-3.5 w-3.5" /> Open
                      </Button>
                      {c.status === InvoiceStatus.DRAFT && (
                        <Button variant="ghost" size="sm" onClick={() => void deleteDraft(c)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      {c.status === InvoiceStatus.FINALIZED && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => void duplicate(c)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setCancelling(c)}>
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
          challan={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={() => {
            setCancelling(null);
            void load();
            toast.info('Challan cancelled');
          }}
        />
      )}
    </div>
  );
}

function CancelModal({
  challan,
  onClose,
  onCancelled,
}: {
  challan: ChallanDto;
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
      await unwrap(window.api.challans.cancel({ id: challan.id, reason }));
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
      title={`Cancel ${challan.challan_number ?? 'challan'}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep challan
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Cancelling…' : 'Cancel Challan'}
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
