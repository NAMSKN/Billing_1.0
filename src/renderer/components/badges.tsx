import { InvoiceStatus, PaymentStatus } from '@shared/domain/enums';
import { Badge } from './ui';

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  if (status === InvoiceStatus.FINALIZED) return <Badge tone="success">Finalized</Badge>;
  if (status === InvoiceStatus.CANCELLED) return <Badge tone="danger">Cancelled</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  if (status === PaymentStatus.PAID) return <Badge tone="success">Paid</Badge>;
  if (status === PaymentStatus.PARTIAL) return <Badge tone="warning">Partial</Badge>;
  return <Badge tone="neutral">Unpaid</Badge>;
}
