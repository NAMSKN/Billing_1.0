import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Search, Ban, Eye, Trash2, FileText, Plus, Copy } from 'lucide-react';
import type { OrderDto } from '@shared/orderDto';
import {
  OrderStatus,
  OrderType,
  ORDER_TYPE_LABEL,
  ORDER_STATUS_LABEL,
} from '@shared/domain/order';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate } from '../lib/format';
import { Button, Card, Input, Select, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import { CopyButton } from '../components/CopyButton';

/** Order status badge (DRAFT/CONFIRMED/COMPLETED/CANCELLED). */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (status === OrderStatus.CONFIRMED) return <Badge tone="accent">Confirmed</Badge>;
  if (status === OrderStatus.COMPLETED) return <Badge tone="success">Completed</Badge>;
  if (status === OrderStatus.CANCELLED) return <Badge tone="danger">Cancelled</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

export function OrderHistory({
  onOpen,
  onNew,
  onOpenInvoice,
}: {
  onOpen: (id: string) => void;
  onNew: (type: OrderType) => void;
  onOpenInvoice?: (invoiceId: string) => void;
}) {
  const toast = useToast();
  const [orders, setOrders] = useState<OrderDto[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const load = async () => setOrders(await unwrap(window.api.orders.listSummaries()));

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        const matchesQuery =
          !query ||
          (o.order_number ?? '').toLowerCase().includes(query.toLowerCase()) ||
          o.party.name.toLowerCase().includes(query.toLowerCase());
        const matchesType = typeFilter === 'ALL' || o.order_type === typeFilter;
        const matchesStatus = statusFilter === 'ALL' || o.status === statusFilter;
        return matchesQuery && matchesType && matchesStatus;
      }),
    [orders, query, typeFilter, statusFilter],
  );

  const deleteDraft = async (o: OrderDto) => {
    if (!window.confirm('Delete this draft order? This cannot be undone.')) return;
    try {
      await unwrap(window.api.orders.deleteDraft(o.id));
      toast.info('Draft deleted');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete draft');
    }
  };

  const cancel = async (o: OrderDto) => {
    const reason = window.prompt('Reason for cancelling this order?');
    if (reason === null) return;
    try {
      await unwrap(window.api.orders.cancel({ id: o.id, reason }));
      toast.info('Order cancelled');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  };

  const convert = async (o: OrderDto) => {
    const target =
      o.order_type === OrderType.PURCHASE_ORDER
        ? 'purchase invoice'
        : o.order_type === OrderType.SERVICE_REQUEST
          ? 'job work invoice'
          : 'sales invoice';
    try {
      const res = await unwrap<{ invoiceId: string }>(window.api.orders.convertToInvoice(o.id));
      toast.success(`Converted to a new ${target} draft`);
      if (onOpenInvoice) onOpenInvoice(res.invoiceId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to convert');
    }
  };

  const duplicate = async (o: OrderDto) => {
    try {
      const dup = await unwrap<OrderDto>(window.api.orders.duplicate(o.id));
      toast.success('Duplicated into a new draft');
      onOpen(dup.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to duplicate');
    }
  };

  return (
    <div>
      <PageHeader
        title="Orders"
        description="Sales orders, purchase orders, and service requests."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onNew(OrderType.SALES_ORDER)}>
              <Plus className="h-4 w-4" /> Sale Order
            </Button>
            <Button variant="outline" onClick={() => onNew(OrderType.PURCHASE_ORDER)}>
              <Plus className="h-4 w-4" /> Purchase Order
            </Button>
            <Button variant="outline" onClick={() => onNew(OrderType.SERVICE_REQUEST)}>
              <Plus className="h-4 w-4" /> Service Request
            </Button>
          </div>
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
        <Select className="w-48" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="ALL">All types</option>
          {Object.values(OrderType).map((t) => (
            <option key={t} value={t}>
              {ORDER_TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        <Select className="w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="ALL">All statuses</option>
          {Object.values(OrderStatus).map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No orders found"
          description="Create a sales order, purchase order, or service request."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-5 py-3 font-medium">Number</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Date</th>
                <th className="px-5 py-3 font-medium">Party</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((o) => {
                const canConvert =
                  o.status === OrderStatus.CONFIRMED || o.status === OrderStatus.COMPLETED;
                return (
                  <tr key={o.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-5 py-3 font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{o.order_number ?? 'Draft'}</span>
                        {o.order_number && <CopyButton text={o.order_number} size={13} />}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">
                      {ORDER_TYPE_LABEL[o.order_type]}
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{formatDate(o.order_date)}</td>
                    <td className="px-5 py-3 text-muted-foreground">{o.party.name || '—'}</td>
                    <td className="px-5 py-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {o.totals ? rupees(o.totals.grand_total) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onOpen(o.id)}>
                          <Eye className="h-3.5 w-3.5" /> Open
                        </Button>
                        {canConvert && (
                          <Button variant="ghost" size="sm" onClick={() => void convert(o)}>
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => void duplicate(o)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        {o.status === OrderStatus.DRAFT && (
                          <Button variant="ghost" size="sm" onClick={() => void deleteDraft(o)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {(o.status === OrderStatus.DRAFT || o.status === OrderStatus.CONFIRMED) && (
                          <Button variant="ghost" size="sm" onClick={() => void cancel(o)}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
