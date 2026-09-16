import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  Printer,
  Download,
  ArrowLeft,
  Loader2,
  PackageSearch,
  Search,
} from 'lucide-react';
import type {
  InvoiceDto,
  InvoiceLineDto,
  CustomerDto,
  CalcPreviewResponse,
  TaxRateConfigDto,
} from '@shared/dto';
import type { ProductDto } from '@shared/productDto';
import { InvoiceStatus, PaymentStatus, TaxTreatment } from '@shared/domain/enums';
import { DiscountType, ITEM_TYPE_LABEL } from '@shared/domain/product';
import { unwrap, ApiError } from '../lib/api';
import { rupees, todayIso } from '../lib/format';
import { Modal } from '../components/Modal';
import { Badge } from '../components/ui';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Select,
  Textarea,
} from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, PaymentBadge } from '../components/badges';
import { StateSelect } from '../components/StateSelect';
import { useToast } from '../components/Toast';

/**
 * Create/Edit Invoice — the primary workflow. A read-only view for finalized /
 * cancelled invoices; a full editor for drafts. Totals are computed live by the
 * engine (calc preview over IPC); the UI never does money math.
 */

function newLine(): InvoiceLineDto {
  return {
    id: crypto.randomUUID(),
    sequence: 0,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: '',
    specification: '',
    hsn_sac: '998898',
    quantity: '1',
    unit: 'NOS',
    rate: '0',
    discount_percent: '0',
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: '18',
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}

/** A fresh, unsaved draft built entirely client-side (persisted on Save). */
function emptyInvoiceDto(): InvoiceDto {
  return {
    id: crypto.randomUUID(),
    invoice_number: null,
    status: InvoiceStatus.DRAFT,
    payment_status: PaymentStatus.UNPAID,
    invoice_date: todayIso(),
    company_id: null,
    customer_id: null,
    place_of_supply: { state_name: '', state_code: '' },
    references: {
      delivery_note: '',
      delivery_note_date: '',
      reference_number: '',
      reference_date: '',
      buyer_order_number: '',
      buyer_order_date: '',
      dispatch_doc_number: '',
      dispatch_date: '',
      lr_rr_number: '',
      vehicle_number: '',
      dispatched_through: '',
      destination: '',
      terms_of_delivery: '',
      other_references: '',
    },
    lines: [newLine()],
    totals: null,
    payment_terms: '',
    due_date: '',
    notes: '',
    terms: '',
    declaration: '',
    template_version: null,
    cancelled_at: '',
    cancel_reason: '',
    replacement_invoice_id: null,
  };
}

export function InvoiceEditor({
  invoiceId,
  onDone,
}: {
  invoiceId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [companyStateCode, setCompanyStateCode] = useState('');
  const [taxConfig, setTaxConfig] = useState<TaxRateConfigDto | null>(null);
  const [preview, setPreview] = useState<CalcPreviewResponse | null>(null);
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const readOnly = invoice?.status !== InvoiceStatus.DRAFT;

  // Load invoice (existing or new draft) plus masters.
  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [custs, company, settings] = await Promise.all([
          unwrap<CustomerDto[]>(window.api.customers.list()),
          unwrap<{ address: { state_code: string } } | null>(window.api.company.get()),
          unwrap<{ tax: TaxRateConfigDto }>(window.api.settings.get()),
        ]);
        setCustomers(custs);
        setCompanyStateCode(company?.address.state_code ?? '');
        setTaxConfig(settings.tax);

        if (invoiceId === 'new') {
          // Build the draft in-memory only; it is persisted on Save/Finalize so
          // merely visiting "New Invoice" never leaves a blank draft behind.
          setInvoice(emptyInvoiceDto());
        } else {
          const inv = await unwrap<InvoiceDto>(window.api.invoices.get(invoiceId));
          setInvoice(inv);
          if (inv.invoice_date) setInvoiceDate(inv.invoice_date);
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Failed to load invoice');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // Live totals preview whenever lines / place of supply / config change.
  const requestPreview = useCallback(async () => {
    if (!invoice || !taxConfig) return;
    try {
      const res = await unwrap<CalcPreviewResponse>(
        window.api.calcPreview({
          companyStateCode,
          placeOfSupplyStateCode: invoice.place_of_supply.state_code,
          taxConfig,
          lines: invoice.lines.map((l) => ({
            hsn_sac: l.hsn_sac,
            quantity: l.quantity,
            rate: l.rate,
            discount_percent: l.discount_percent,
          })),
        }),
      );
      setPreview(res);
    } catch {
      setPreview(null);
    }
  }, [invoice, taxConfig, companyStateCode]);

  useEffect(() => {
    void requestPreview();
  }, [requestPreview]);

  if (loading || !invoice) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const setInv = (patch: Partial<InvoiceDto>) => setInvoice((i) => (i ? { ...i, ...patch } : i));

  const setLine = (index: number, patch: Partial<InvoiceLineDto>) =>
    setInvoice((i) => {
      if (!i) return i;
      const lines = i.lines.map((l, idx) => (idx === index ? { ...l, ...patch } : l));
      return { ...i, lines };
    });

  const addLine = () => setInvoice((i) => (i ? { ...i, lines: [...i.lines, newLine()] } : i));
  const removeLine = (index: number) =>
    setInvoice((i) => (i ? { ...i, lines: i.lines.filter((_, idx) => idx !== index) } : i));

  /**
   * Insert an editable line prefilled from a catalogue product. The product is
   * only a source of defaults — the line stays fully editable and the engine
   * still owns all tax/total math. A percentage sale discount carries to the
   * line; a rupee discount does not.
   */
  const insertProduct = (product: ProductDto) => {
    const discountPercent =
      product.sale_discount_type === DiscountType.PERCENTAGE ? product.sale_discount_value : '0';
    const line: InvoiceLineDto = {
      ...newLine(),
      description: product.name,
      hsn_sac: product.hsn_sac_code,
      unit: product.unit_of_measurement,
      quantity: '1',
      rate: product.sell_price,
      discount_percent: discountPercent,
      tax_rate: product.tax_rate,
    };
    setInvoice((i) => (i ? { ...i, lines: [...i.lines, line] } : i));
    setPickerOpen(false);
  };

  const onSelectCustomer = (customerId: string) => {
    const cust = customers.find((c) => c.id === customerId);
    // Default place of supply from the customer's billing state.
    setInv({
      customer_id: customerId || null,
      place_of_supply: cust
        ? { state_code: cust.bill_to.state_code, state_name: cust.bill_to.state_name }
        : invoice.place_of_supply,
    });
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const res = await unwrap<{ invoice: InvoiceDto }>(
        window.api.invoices.saveDraft({ ...invoice, invoice_date: invoiceDate }),
      );
      setInvoice(res.invoice);
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save draft');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    setBusy(true);
    try {
      // Persist current edits first so finalize reads the latest draft.
      await unwrap(window.api.invoices.saveDraft({ ...invoice, invoice_date: invoiceDate }));
      const finalized = await unwrap<InvoiceDto>(
        window.api.invoices.finalize({ id: invoice.id, invoiceDate }),
      );
      setInvoice(finalized);
      toast.success(`Finalized as ${finalized.invoice_number}`);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        toast.error(err.issues[0].message);
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Failed to finalize');
      }
    } finally {
      setBusy(false);
    }
  };

  const setPayment = async (status: PaymentStatus) => {
    try {
      const updated = await unwrap<InvoiceDto>(
        window.api.invoices.setPaymentStatus({ id: invoice.id, status }),
      );
      setInvoice(updated);
      toast.success('Payment status updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update payment');
    }
  };

  return (
    <div>
      <PageHeader
        title={invoice.invoice_number ?? (readOnly ? 'Invoice' : 'New Invoice')}
        description={readOnly ? 'This invoice is a finalized historical record.' : 'Draft — editable until finalized.'}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <StatusBadge status={invoice.status} />
            {readOnly && invoice.status === InvoiceStatus.FINALIZED && (
              <PaymentBadge status={invoice.payment_status} />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* Left: form / detail */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Customer">
                <Select
                  value={invoice.customer_id ?? ''}
                  onChange={(e) => onSelectCustomer(e.target.value)}
                  disabled={readOnly}
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Invoice date">
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Place of supply (tax determination)">
                <StateSelect
                  code={invoice.place_of_supply.state_code}
                  onChange={(state_code, state_name) =>
                    setInv({ place_of_supply: { state_code, state_name } })
                  }
                />
              </Field>
              <Field label="Due date (optional)">
                <Input
                  type="date"
                  value={invoice.due_date}
                  onChange={(e) => setInv({ due_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Line Items</CardTitle>
                {!readOnly && (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
                      <PackageSearch className="h-3.5 w-3.5" /> Add from Catalogue
                    </Button>
                    <Button variant="outline" size="sm" onClick={addLine}>
                      <Plus className="h-3.5 w-3.5" /> Add line
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {invoice.lines.map((line, index) => (
                <LineRow
                  key={line.id}
                  line={line}
                  index={index}
                  readOnly={readOnly}
                  amount={preview?.lines[index]?.amount}
                  onChange={(patch) => setLine(index, patch)}
                  onRemove={() => removeLine(index)}
                  canRemove={invoice.lines.length > 1}
                  onEnter={addLine}
                />
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notes &amp; Terms</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Field label="Notes">
                <Textarea
                  value={invoice.notes}
                  onChange={(e) => setInv({ notes: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Terms & conditions">
                <Textarea
                  value={invoice.terms}
                  onChange={(e) => setInv({ terms: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>
        </div>

        {/* Right: totals + actions (sticky) */}
        <div className="space-y-4">
          <Card className="sticky top-0">
            <CardHeader>
              <CardTitle>
                {preview?.tax_type === 'INTER_STATE' ? 'Totals (IGST)' : 'Totals (CGST + SGST)'}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-2.5 text-sm">
              <TotalRow label="Taxable" value={preview?.totals.total_taxable} />
              {preview?.tax_type === 'INTER_STATE' ? (
                <TotalRow label="IGST" value={preview?.totals.total_igst} />
              ) : (
                <>
                  <TotalRow label="CGST" value={preview?.totals.total_cgst} />
                  <TotalRow label="SGST" value={preview?.totals.total_sgst} />
                </>
              )}
              <TotalRow label="Round-off" value={preview?.totals.round_off} />
              <div className="my-2 border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Grand Total</span>
                <span className="text-lg font-semibold tabular-nums text-accent">
                  {rupees(preview?.totals.grand_total)}
                </span>
              </div>
              {preview?.grand_total_words && (
                <p className="pt-1 text-xs italic text-muted-foreground">
                  {preview.grand_total_words}
                </p>
              )}
            </CardBody>
          </Card>

          {!readOnly ? (
            <div className="space-y-2">
              <Button className="w-full" variant="outline" onClick={() => void saveDraft()} disabled={busy}>
                <Save className="h-4 w-4" /> Save Draft
              </Button>
              <Button className="w-full" onClick={() => void finalize()} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" /> Finalize Invoice
              </Button>
            </div>
          ) : invoice.status === InvoiceStatus.FINALIZED ? (
            <FinalizedActions
              invoice={invoice}
              onSetPayment={(s) => void setPayment(s)}
              toastError={(m) => toast.error(m)}
              toastInfo={(m) => toast.info(m)}
            />
          ) : (
            <Card>
              <CardBody className="text-sm text-muted-foreground">
                Cancelled on {invoice.cancelled_at.slice(0, 10)}.
                {invoice.cancel_reason && <div className="mt-1">Reason: {invoice.cancel_reason}</div>}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {pickerOpen && (
        <ProductPickerModal onClose={() => setPickerOpen(false)} onPick={insertProduct} />
      )}
    </div>
  );
}

function ProductPickerModal({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (product: ProductDto) => void;
}) {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        setProducts(await unwrap<ProductDto[]>(window.api.products.sellable()));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.hsn_sac_code.toLowerCase().includes(needle) ||
        p.barcode_no.toLowerCase().includes(needle),
    );
  }, [products, query]);

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Add from Catalogue">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search products, services, HSN/SAC…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>
      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {products.length === 0
            ? 'No sellable products yet. Add or import some in Products / Services.'
            : 'No matches.'}
        </p>
      ) : (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {filtered.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onPick(p)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ITEM_TYPE_LABEL[p.item_type]}
                    {p.hsn_sac_code ? ` · HSN ${p.hsn_sac_code}` : ''}
                    {p.unit_of_measurement ? ` · ${p.unit_of_measurement}` : ''}
                  </p>
                </div>
                <Badge tone="neutral">{p.tax_rate}%</Badge>
                <span className="w-24 text-right text-sm font-medium tabular-nums">
                  {rupees(p.sell_price)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TotalRow({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{rupees(value)}</span>
    </div>
  );
}

function LineRow({
  line,
  index,
  readOnly,
  amount,
  onChange,
  onRemove,
  canRemove,
  onEnter,
}: {
  line: InvoiceLineDto;
  index: number;
  readOnly: boolean;
  amount?: string;
  onChange: (patch: Partial<InvoiceLineDto>) => void;
  onRemove: () => void;
  canRemove: boolean;
  onEnter: () => void;
}) {
  const rateRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Line {index + 1}</span>
        {!readOnly && canRemove && (
          <button
            onClick={onRemove}
            className="text-muted-foreground transition-colors hover:text-danger"
            aria-label="Remove line"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-12 gap-2">
        <Field label="Job / Mould" className="col-span-3">
          <Input
            value={line.job_or_mould_reference}
            onChange={(e) => onChange({ job_or_mould_reference: e.target.value })}
            disabled={readOnly}
          />
        </Field>
        <Field label="Operation" className="col-span-4">
          <Input
            value={line.operation}
            onChange={(e) => onChange({ operation: e.target.value })}
            disabled={readOnly}
          />
        </Field>
        <Field label="HSN/SAC" className="col-span-2">
          <Input
            value={line.hsn_sac}
            onChange={(e) => onChange({ hsn_sac: e.target.value })}
            disabled={readOnly}
          />
        </Field>
        <Field label="Unit" className="col-span-3">
          <Input value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} disabled={readOnly} />
        </Field>

        <Field label="Description" className="col-span-12">
          <Input
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
            disabled={readOnly}
            placeholder="e.g. DRILL DIA 9X307MM DEEP"
          />
        </Field>

        <Field label="Qty" className="col-span-3">
          <Input
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            disabled={readOnly}
            inputMode="decimal"
          />
        </Field>
        <Field label="Rate" className="col-span-3">
          <Input
            ref={rateRef}
            value={line.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            disabled={readOnly}
            inputMode="decimal"
          />
        </Field>
        <Field label="Disc %" className="col-span-2">
          <Input
            value={line.discount_percent}
            onChange={(e) => onChange({ discount_percent: e.target.value })}
            disabled={readOnly}
            inputMode="decimal"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !readOnly) onEnter();
            }}
          />
        </Field>
        <Field label="Amount" className="col-span-4">
          <div className="flex h-10 items-center justify-end rounded-md bg-muted px-3 text-sm font-medium tabular-nums">
            {rupees(amount)}
          </div>
        </Field>
      </div>
    </div>
  );
}

function FinalizedActions({
  invoice,
  onSetPayment,
  toastError,
  toastInfo,
}: {
  invoice: InvoiceDto;
  onSetPayment: (s: PaymentStatus) => void;
  toastError: (m: string) => void;
  toastInfo: (m: string) => void;
}) {
  const [exporting, setExporting] = useState(false);

  const preview = async () => {
    try {
      await unwrap(window.api.pdf.preview(invoice.id));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Preview not available yet');
    }
  };

  const exportPdf = async () => {
    setExporting(true);
    try {
      const path = await unwrap<string>(window.api.pdf.export({ id: invoice.id }));
      toastInfo(`Exported to ${path}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Export not available yet');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Payment status</p>
          <Select
            value={invoice.payment_status}
            onChange={(e) => onSetPayment(e.target.value as PaymentStatus)}
          >
            <option value={PaymentStatus.UNPAID}>Unpaid</option>
            <option value={PaymentStatus.PARTIAL}>Partial</option>
            <option value={PaymentStatus.PAID}>Paid</option>
          </Select>
        </CardBody>
      </Card>
      <div className="space-y-2">
        <Button className="w-full" variant="outline" onClick={() => void preview()}>
          <Printer className="h-4 w-4" /> Preview PDF
        </Button>
        <Button className="w-full" onClick={() => void exportPdf()} disabled={exporting}>
          <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export PDF'}
        </Button>
      </div>
    </div>
  );
}
