import { useEffect, useState } from 'react';
import { ArrowLeft, Save, CheckCircle2, Link2, Printer } from 'lucide-react';
import type { PartyDto } from '@shared/partyDto';
import type {
  AllocatableInvoiceDto,
  PaymentDto,
  PaymentDraftInputDto,
} from '@shared/paymentDto';
import {
  VoucherDirection,
  VOUCHER_DIRECTION_LABEL,
  VOUCHER_PARTY_LABEL,
  PaymentMode,
  PAYMENT_MODE_LABEL,
  AllocationStatus,
} from '@shared/domain/payment';
import { InvoiceStatus } from '@shared/domain/enums';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate, todayIso } from '../lib/format';
import { Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Textarea, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';

/**
 * Receipt / Payment voucher editor. Handles both directions:
 *   - RECEIPT: party = customer; may allocate to sales / job work invoices.
 *   - PAYMENT: party = vendor; may allocate to purchase invoices.
 * A voucher may be left unallocated (advance / deposit). Allocations only
 * affect an invoice's payment status when the user explicitly CONFIRMS them
 * (D-032). Finalizing pins the immutable snapshot and issues the number.
 */
export function PaymentEditor({
  paymentId,
  direction: newDirection,
  onDone,
}: {
  paymentId: string; // 'new' or an existing id
  direction?: VoucherDirection;
  onDone: () => void;
}) {
  const toast = useToast();
  const [voucher, setVoucher] = useState<PaymentDto | null>(null);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<AllocatableInvoiceDto[]>([]);
  // invoice_id -> amount string entered by the user.
  const [alloc, setAlloc] = useState<Record<string, string>>({});

  const isNew = paymentId === 'new';
  const direction = voucher?.direction ?? newDirection ?? VoucherDirection.RECEIPT;
  const noun = VOUCHER_DIRECTION_LABEL[direction];
  const readOnly = voucher?.status !== InvoiceStatus.DRAFT && !isNew;

  useEffect(() => {
    void (async () => {
      try {
        let v: PaymentDto;
        if (isNew) {
          v = await unwrap<PaymentDto>(window.api.payments.createDraft(direction));
        } else {
          const got = await unwrap<PaymentDto | null>(window.api.payments.get(paymentId));
          if (!got) {
            toast.error('Voucher not found');
            onDone();
            return;
          }
          v = got;
        }
        setVoucher(v);
        // Party candidates: customers for a receipt, vendors for a payment.
        const role = v.direction === VoucherDirection.RECEIPT ? 'CUSTOMER' : 'VENDOR';
        const pty = await unwrap<PartyDto[]>(
          window.api.parties.list({ role, includeArchived: false }),
        );
        setParties(pty);
        // Seed allocation amounts from any existing allocations.
        const seed: Record<string, string> = {};
        for (const a of v.allocations) seed[a.invoice_id] = a.amount;
        setAlloc(seed);
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Failed to load voucher');
        onDone();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentId]);

  const patch = (p: Partial<PaymentDto>) => setVoucher((v) => (v ? { ...v, ...p } : v));

  const persistDraft = async (): Promise<PaymentDto | null> => {
    if (!voucher) return null;
    const input: PaymentDraftInputDto = {
      direction: voucher.direction,
      party_id: voucher.party_id,
      payment_date: voucher.payment_date || todayIso(),
      amount: voucher.amount,
      mode: voucher.mode,
      reference_no: voucher.reference_no,
      remarks: voucher.remarks,
    };
    const saved = await unwrap<PaymentDto>(
      window.api.payments.saveDraft({ id: voucher.id, input }),
    );
    setVoucher(saved);
    return saved;
  };

  const save = async () => {
    if (!voucher) return;
    setSaving(true);
    try {
      await persistDraft();
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const loadCandidates = async () => {
    if (!voucher) return;
    try {
      await persistDraft(); // ensure party/amount are saved before matching
      const list = await unwrap<AllocatableInvoiceDto[]>(
        window.api.payments.allocatableInvoices(voucher.id),
      );
      setCandidates(list);
      if (list.length === 0) toast.info('No open invoices to allocate against');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to load invoices');
    }
  };

  const allocationInputs = () =>
    Object.entries(alloc)
      .filter(([, amt]) => amt && Number(amt) > 0)
      .map(([invoice_id, amount]) => ({ invoice_id, amount }));

  const saveDraftAllocations = async () => {
    if (!voucher) return;
    try {
      const saved = await persistDraft();
      if (!saved) return;
      const v = await unwrap<PaymentDto>(
        window.api.payments.setDraftAllocations({ id: saved.id, allocations: allocationInputs() }),
      );
      setVoucher(v);
      toast.success('Allocations saved as draft (not yet applied)');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save allocations');
    }
  };

  const confirmAllocations = async () => {
    if (!voucher) return;
    if (
      !window.confirm(
        'Confirm these allocations? Confirmed allocations update the linked invoices\u2019 payment status and outstanding balance.',
      )
    ) {
      return;
    }
    try {
      const saved = await persistDraft();
      if (!saved) return;
      const v = await unwrap<PaymentDto>(
        window.api.payments.confirmAllocations({ id: saved.id, allocations: allocationInputs() }),
      );
      setVoucher(v);
      toast.success('Allocations confirmed and applied to invoices');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to confirm allocations');
    }
  };

  const finalize = async () => {
    if (!voucher) return;
    setSaving(true);
    try {
      await persistDraft();
      const v = await unwrap<PaymentDto>(
        window.api.payments.finalize({ id: voucher.id, paymentDate: voucher.payment_date || todayIso() }),
      );
      setVoucher(v);
      toast.success(`${noun} finalized: ${v.payment_number}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to finalize');
    } finally {
      setSaving(false);
    }
  };

  const printPdf = async () => {
    if (!voucher) return;
    try {
      await unwrap(window.api.payments.pdfPreview(voucher.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to open PDF');
    }
  };

  if (!voucher) {
    return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  }

  const confirmedTotal = voucher.allocations
    .filter((a) => a.status === AllocationStatus.CONFIRMED)
    .reduce((s, a) => s + Number(a.amount), 0);

  // Live total of the amounts the user has typed into the allocation grid, and
  // whether it exceeds the voucher amount (item 5 validation surfaced in UI).
  const enteredTotal = Object.values(alloc).reduce((s, v) => s + (Number(v) || 0), 0);
  const voucherAmount = Number(voucher.amount) || 0;
  const overAllocated = enteredTotal > voucherAmount + 1e-9;

  // Check if any individual allocation exceeds the invoice's outstanding balance
  const candidatesById = new Map(candidates.map((c) => [c.invoice_id, c]));
  const hasLineExceeded = Object.entries(alloc).some(([id, amt]) => {
    const num = Number(amt) || 0;
    if (num <= 0) return false;
    const cand = candidatesById.get(id);
    return cand ? num > Number(cand.outstanding) + 1e-9 : false;
  });
  const hasNegativeAlloc = Object.values(alloc).some((amt) => Number(amt) < 0);
  const canSaveAllocations = !overAllocated && !hasLineExceeded && !hasNegativeAlloc;

  return (
    <div>
      <PageHeader
        title={`${isNew ? 'New' : ''} ${noun}${voucher.payment_number ? ` ${voucher.payment_number}` : ''}`.trim()}
        copyText={voucher.payment_number ?? undefined}
        description={VOUCHER_PARTY_LABEL[direction]}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {!readOnly && (
              <>
                <Button variant="outline" onClick={() => void save()} disabled={saving}>
                  <Save className="h-4 w-4" /> Save Draft
                </Button>
                <Button onClick={() => void finalize()} disabled={saving}>
                  <CheckCircle2 className="h-4 w-4" /> Finalize
                </Button>
              </>
            )}
            {voucher.status === InvoiceStatus.FINALIZED && (
              <Button variant="outline" onClick={() => void printPdf()}>
                <Printer className="h-4 w-4" /> Print
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{noun} Details</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <Field label={`${VOUCHER_PARTY_LABEL[direction]} *`}>
              <Select
                value={voucher.party_id ?? ''}
                onChange={(e) => {
                  const p = parties.find((x) => x.id === e.target.value) ?? null;
                  patch({
                    party_id: p ? p.id : null,
                    party: p
                      ? {
                          ...voucher.party,
                          party_id: p.id,
                          name: p.company_name,
                          gstin: p.gstin,
                        }
                      : voucher.party,
                  });
                }}
                disabled={readOnly}
              >
                <option value="">— Select {direction === VoucherDirection.RECEIPT ? 'customer' : 'vendor'} —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.company_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={`${noun} Date *`}>
                <Input
                  type="date"
                  value={voucher.payment_date || todayIso()}
                  onChange={(e) => patch({ payment_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Amount *">
                <Input
                  value={voucher.amount}
                  onChange={(e) => patch({ amount: e.target.value })}
                  inputMode="decimal"
                  disabled={readOnly}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Payment Mode *">
                <Select
                  value={voucher.mode}
                  onChange={(e) => patch({ mode: e.target.value as PaymentMode })}
                  disabled={readOnly}
                >
                  {Object.values(PaymentMode).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_MODE_LABEL[m]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference No.">
                <Input
                  value={voucher.reference_no}
                  onChange={(e) => patch({ reference_no: e.target.value })}
                  placeholder="Cheque / UTR / txn id"
                  disabled={readOnly}
                />
              </Field>
            </div>
            <Field label="Remarks">
              <Textarea
                value={voucher.remarks}
                onChange={(e) => patch({ remarks: e.target.value })}
                disabled={readOnly}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Link2 className="h-4 w-4" /> Invoice Allocation
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Optional. Allocate this {noun.toLowerCase()} across one or more invoices. Allocations
              only affect an invoice&rsquo;s payment status once you press <b>Confirm</b>. Leave
              empty for an advance / deposit.
            </p>

            {!readOnly && (
              <Button variant="outline" size="sm" onClick={() => void loadCandidates()}>
                Find open invoices
              </Button>
            )}

            {candidates.length > 0 && (
              <div className="rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                      <th className="px-3 py-2 text-right font-medium">Allocate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {candidates.map((c) => {
                      const enteredVal = Number(alloc[c.invoice_id]) || 0;
                      const outstandingVal = Number(c.outstanding) || 0;
                      const lineExceeded = enteredVal > outstandingVal + 1e-9;
                      const lineNegative = enteredVal < 0;
                      const isLineInvalid = lineExceeded || lineNegative;
                      return (
                        <tr key={c.invoice_id}>
                          <td className="px-3 py-2 font-medium">{c.invoice_number}</td>
                          <td className="px-3 py-2 text-muted-foreground">{formatDate(c.invoice_date)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{rupees(c.outstanding)}</td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex flex-col items-end">
                              <Input
                                className={`w-28 text-right ${isLineInvalid ? 'border-danger focus-visible:ring-danger text-danger' : ''}`}
                                value={alloc[c.invoice_id] ?? ''}
                                onChange={(e) => setAlloc((a) => ({ ...a, [c.invoice_id]: e.target.value }))}
                                inputMode="decimal"
                                placeholder="0.00"
                                disabled={readOnly}
                              />
                              {lineExceeded && (
                                <span className="text-[10px] text-danger mt-0.5">
                                  Exceeds outstanding ({rupees(c.outstanding)})
                                </span>
                              )}
                              {lineNegative && (
                                <span className="text-[10px] text-danger mt-0.5">
                                  Must be positive
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {!readOnly && candidates.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Allocated / Voucher amount</span>
                  <span
                    className={
                      overAllocated ? 'font-medium text-danger tabular-nums' : 'tabular-nums text-muted-foreground'
                    }
                  >
                    {rupees(enteredTotal.toFixed(2))} / {rupees(voucher.amount)}
                  </span>
                </div>
                {overAllocated && (
                  <p className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">
                    Allocations exceed the voucher amount by{' '}
                    {rupees((enteredTotal - voucherAmount).toFixed(2))}. Reduce an amount before
                    saving or confirming.
                  </p>
                )}
                {hasLineExceeded && !overAllocated && (
                  <p className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">
                    One or more allocations exceed the invoice&rsquo;s outstanding balance. Adjust the amount before saving or confirming.
                  </p>
                )}
                {hasNegativeAlloc && (
                  <p className="rounded-md bg-danger/10 px-2 py-1 text-xs text-danger">
                    Allocation amounts must be positive numbers.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void saveDraftAllocations()}
                    disabled={!canSaveAllocations}
                  >
                    Save as draft
                  </Button>
                  <Button size="sm" onClick={() => void confirmAllocations()} disabled={!canSaveAllocations}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Confirm allocations
                  </Button>
                </div>
              </div>
            )}

            {voucher.allocations.length > 0 && (
              <div className="rounded-md bg-muted/40 p-3 text-xs">
                <div className="mb-1 font-medium">Current allocations</div>
                <ul className="space-y-1">
                  {voucher.allocations.map((a) => (
                    <li key={a.id} className="flex items-center justify-between">
                      <span>
                        {a.invoice_number}{' '}
                        {a.status === AllocationStatus.CONFIRMED ? (
                          <Badge tone="success">Confirmed</Badge>
                        ) : (
                          <Badge tone="neutral">Draft</Badge>
                        )}
                      </span>
                      <span className="tabular-nums">{rupees(a.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex justify-between border-t border-border pt-2 font-medium">
                  <span>Confirmed / Amount</span>
                  <span className="tabular-nums">
                    {rupees(confirmedTotal.toFixed(2))} / {rupees(voucher.amount)}
                  </span>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
