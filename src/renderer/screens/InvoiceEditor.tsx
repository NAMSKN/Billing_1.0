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
  Share2,
} from 'lucide-react';
import { openWhatsAppShare, composeInvoiceWhatsAppMessage } from '../lib/whatsapp';
import { ThermalReceiptModal, ThermalReceiptData } from '../components/ThermalReceiptModal';
import type {
  InvoiceDto,
  InvoiceLineDto,
  CustomerDto,
  CalcPreviewResponse,
  TaxRateConfigDto,
} from '@shared/dto';
import type { ProductDto } from '@shared/productDto';
import type { PartyDto } from '@shared/partyDto';
import type { ChallanDto } from '@shared/challanDto';
import {
  InvoiceKind,
  InvoiceStatus,
  LineItemType,
  PaymentStatus,
  TaxTreatment,
  INVOICE_KIND_LABEL,
  InvoiceCopyType,
  INVOICE_COPY_LABEL,
  INVOICE_COPY_ORDER,
} from '@shared/domain/enums';
import { DiscountType, ItemType, ITEM_TYPE_LABEL } from '@shared/domain/product';
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
import { UnitSelect } from '../components/UnitSelect';
import { DEFAULT_UNIT } from '@shared/domain/units';
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
    item_type: LineItemType.PRODUCT,
    product_id: null,
    job_or_mould_reference: '',
    component_or_part: '',
    operation: '',
    description: '',
    specification: '',
    hsn_sac: '998898',
    quantity: '1',
    unit: DEFAULT_UNIT,
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
function emptyInvoiceDto(kind: InvoiceKind = InvoiceKind.SALES): InvoiceDto {
  return {
    id: crypto.randomUUID(),
    kind,
    invoice_number: null,
    status: InvoiceStatus.DRAFT,
    payment_status: PaymentStatus.UNPAID,
    invoice_date: todayIso(),
    company_id: null,
    customer_id: null,
    party_id: null,
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
    payment_mode: '',
    payment_type: '',
    due_date: '',
    notes: '',
    terms: '',
    declaration: '',
    source_document_type: '',
    source_document_number: '',
    source_document_id: null,
    template_version: null,
    cancelled_at: '',
    cancel_reason: '',
    replacement_invoice_id: null,
  };
}

export function InvoiceEditor({
  invoiceId,
  newKind,
  onDone,
}: {
  invoiceId: string;
  newKind?: InvoiceKind;
  onDone: () => void;
}) {
  const toast = useToast();
  const [invoice, setInvoice] = useState<InvoiceDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [vendors, setVendors] = useState<PartyDto[]>([]);
  const [challans, setChallans] = useState<ChallanDto[]>([]);
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
        const [custs, vends, chlns, company, settings] = await Promise.all([
          unwrap<CustomerDto[]>(window.api.customers.list()),
          unwrap<PartyDto[]>(window.api.parties.list({ role: 'VENDOR', includeArchived: false })),
          unwrap<ChallanDto[]>(window.api.challans.listSummaries()),
          unwrap<{ address: { state_code: string } } | null>(window.api.company.get()),
          unwrap<{ tax: TaxRateConfigDto }>(window.api.settings.get()),
        ]);
        setCustomers(custs);
        setVendors(vends);
        setChallans(chlns);
        setCompanyStateCode(company?.address.state_code ?? '');
        setTaxConfig(settings.tax);

        if (invoiceId === 'new') {
          // Build the draft in-memory only; it is persisted on Save/Finalize so
          // merely visiting "New Invoice" never leaves a blank draft behind.
          setInvoice(emptyInvoiceDto(newKind));
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

  const setRef = (patch: Partial<InvoiceDto['references']>) =>
    setInvoice((i) => (i ? { ...i, references: { ...i.references, ...patch } } : i));

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
      item_type:
        product.item_type === ItemType.SERVICE ? LineItemType.SERVICE : LineItemType.PRODUCT,
      product_id: product.id,
      description: product.name,
      hsn_sac: product.hsn_sac_code,
      unit: product.unit_of_measurement || DEFAULT_UNIT,
      quantity: '1',
      rate: product.sell_price,
      discount_percent: discountPercent,
      tax_rate: product.tax_rate,
    };
    setInvoice((i) => (i ? { ...i, lines: [...i.lines, line] } : i));
    setPickerOpen(false);
  };

  const isPurchase = invoice.kind === InvoiceKind.PURCHASE;

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

  const onSelectVendor = (partyId: string) => {
    const v = vendors.find((p) => p.id === partyId);
    setInv({
      party_id: partyId || null,
      place_of_supply: v
        ? { state_code: v.billing_address.state_code, state_name: v.billing_address.state }
        : invoice.place_of_supply,
    });
  };

  /**
   * Update the billing state directly on the invoice (drives tax) and,
   * optionally, persist it back to the selected customer master so the two stay
   * in sync (item 9). The customer update is best-effort and non-blocking.
   */
  const onChangeBillingState = async (stateCode: string, stateName: string) => {
    setInv({ place_of_supply: { state_code: stateCode, state_name: stateName } });
    if (!isPurchase && invoice.customer_id) {
      const cust = customers.find((c) => c.id === invoice.customer_id);
      if (cust && cust.bill_to.state_code !== stateCode) {
        const sync = window.confirm(
          `Also update ${cust.name}'s billing state to ${stateName}? This changes the customer master.`,
        );
        if (sync) {
          try {
            const updated: CustomerDto = {
              ...cust,
              bill_to: { ...cust.bill_to, state_code: stateCode, state_name: stateName },
            };
            await unwrap(window.api.customers.save(updated));
            setCustomers((cs) => cs.map((c) => (c.id === cust.id ? updated : c)));
            toast.success('Customer billing state updated');
          } catch (err) {
            toast.error(err instanceof ApiError ? err.message : 'Failed to update customer');
          }
        }
      }
    }
  };

  /** Auto-fill dispatch fields from a selected Delivery Challan (item 3). */
  const onSelectDispatchChallan = (challanNumber: string) => {
    const ch = challans.find((c) => (c.challan_number ?? '') === challanNumber);
    if (!ch) {
      setRef({ dispatch_doc_number: challanNumber });
      return;
    }
    setRef({
      dispatch_doc_number: ch.challan_number ?? '',
      dispatch_date: ch.challan_date,
      dispatched_through: ch.delivery_mode || invoice.references.dispatched_through,
      destination: ch.ship_to?.state_name || invoice.references.destination,
      delivery_note: ch.challan_number ?? '',
      delivery_note_date: ch.challan_date,
      terms_of_delivery: ch.delivery_mode || invoice.references.terms_of_delivery,
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
        title={invoice.invoice_number ?? `New ${INVOICE_KIND_LABEL[invoice.kind]}`}
        copyText={invoice.invoice_number ?? undefined}
        description={
          readOnly
            ? `This ${INVOICE_KIND_LABEL[invoice.kind].toLowerCase()} is a finalized historical record.`
            : `${INVOICE_KIND_LABEL[invoice.kind]} draft — editable until finalized.`
        }
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
              {isPurchase ? (
                <Field label="Vendor">
                  <Select
                    value={invoice.party_id ?? ''}
                    onChange={(e) => onSelectVendor(e.target.value)}
                    disabled={readOnly}
                  >
                    <option value="">Select vendor…</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.company_name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
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
              )}
              <Field label="Invoice date">
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Billing state / Place of supply (tax determination)">
                <StateSelect
                  code={invoice.place_of_supply.state_code}
                  disabled={readOnly}
                  onChange={(state_code, state_name) =>
                    void onChangeBillingState(state_code, state_name)
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
              {invoice.source_document_number && (
                <div className="col-span-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Generated from source document -{' '}
                  <span className="font-medium text-foreground">
                    {invoice.source_document_number}
                  </span>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>References &amp; Dispatch</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Reference No.">
                <Input
                  value={invoice.references.reference_number}
                  onChange={(e) => setRef({ reference_number: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Reference Date">
                <Input
                  type="date"
                  value={invoice.references.reference_date}
                  onChange={(e) => setRef({ reference_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Buyer's Order No.">
                <Input
                  value={invoice.references.buyer_order_number}
                  onChange={(e) => setRef({ buyer_order_number: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Buyer's Order Date">
                <Input
                  type="date"
                  value={invoice.references.buyer_order_date}
                  onChange={(e) => setRef({ buyer_order_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Delivery Challan No. (Dispatch Doc)">
                <Select
                  value={invoice.references.dispatch_doc_number}
                  onChange={(e) => onSelectDispatchChallan(e.target.value)}
                  disabled={readOnly}
                >
                  <option value="">Select challan…</option>
                  {/* Preserve a legacy/free-typed value that isn't in the list. */}
                  {invoice.references.dispatch_doc_number &&
                    !challans.some(
                      (c) => (c.challan_number ?? '') === invoice.references.dispatch_doc_number,
                    ) && (
                      <option value={invoice.references.dispatch_doc_number}>
                        {invoice.references.dispatch_doc_number}
                      </option>
                    )}
                  {challans
                    .filter((c) => c.challan_number)
                    .map((c) => (
                      <option key={c.id} value={c.challan_number ?? ''}>
                        {c.challan_number} — {c.party.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Dispatch Date">
                <Input
                  type="date"
                  value={invoice.references.dispatch_date}
                  onChange={(e) => setRef({ dispatch_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Dispatched Through">
                <Input
                  value={invoice.references.dispatched_through}
                  onChange={(e) => setRef({ dispatched_through: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Destination">
                <Input
                  value={invoice.references.destination}
                  onChange={(e) => setRef({ destination: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Delivery Note">
                <Input
                  value={invoice.references.delivery_note}
                  onChange={(e) => setRef({ delivery_note: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Delivery Note Date">
                <Input
                  type="date"
                  value={invoice.references.delivery_note_date}
                  onChange={(e) => setRef({ delivery_note_date: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Terms of Delivery">
                <Input
                  value={invoice.references.terms_of_delivery}
                  onChange={(e) => setRef({ terms_of_delivery: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Other References">
                <Input
                  value={invoice.references.other_references}
                  onChange={(e) => setRef({ other_references: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Mode / Terms of Payment">
                <Input
                  value={invoice.payment_mode}
                  onChange={(e) => setInv({ payment_mode: e.target.value })}
                  placeholder="e.g. 30 days / NEFT"
                  disabled={readOnly}
                />
              </Field>
              <Field label="Payment Type">
                <Input
                  list="invoice-payment-types"
                  value={invoice.payment_type}
                  onChange={(e) => setInv({ payment_type: e.target.value })}
                  placeholder="Select or type…"
                  disabled={readOnly}
                />
                <datalist id="invoice-payment-types">
                  <option value="Cash" />
                  <option value="Credit" />
                  <option value="UPI" />
                  <option value="Bank Transfer" />
                  <option value="Cheque" />
                  <option value="Card" />
                </datalist>
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
              customers={customers}
              vendors={vendors}
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
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Line {index + 1}</span>
          <Select
            className="h-7 w-28 text-xs"
            value={line.item_type}
            onChange={(e) => onChange({ item_type: e.target.value as LineItemType })}
            disabled={readOnly}
          >
            <option value={LineItemType.PRODUCT}>Product</option>
            <option value={LineItemType.SERVICE}>Service</option>
          </Select>
        </div>
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
          <UnitSelect value={line.unit} onChange={(unit) => onChange({ unit })} disabled={readOnly} />
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
  customers,
  vendors,
  onSetPayment,
  toastError,
  toastInfo,
}: {
  invoice: InvoiceDto;
  customers: CustomerDto[];
  vendors: PartyDto[];
  onSetPayment: (s: PaymentStatus) => void;
  toastError: (m: string) => void;
  toastInfo: (m: string) => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [thermalOpen, setThermalOpen] = useState(false);

  const partyName = useMemo(() => {
    if (invoice.customer_id) {
      return customers.find((c) => c.id === invoice.customer_id)?.name || 'Customer';
    }
    if (invoice.party_id) {
      return vendors.find((v) => v.id === invoice.party_id)?.company_name || 'Vendor';
    }
    return 'Customer';
  }, [invoice, customers, vendors]);

  const thermalData: ThermalReceiptData = useMemo(() => ({
    companyName: 'Precision Moulds & Dies',
    companyAddress: 'Peenya Industrial Area, Bangalore',
    companyGstin: invoice.place_of_supply.state_code ? '29AABCB1234F1Z5' : undefined,
    invoiceNumber: invoice.invoice_number || 'Draft',
    invoiceDate: invoice.invoice_date,
    customerName: partyName,
    lines: invoice.lines.map((l) => ({
      name: l.description || l.operation || 'Item',
      quantity: Number(l.quantity),
      unit: l.unit,
      rate: Number(l.rate),
      amount: Number(l.quantity) * Number(l.rate),
    })),
    subtotal: Number(invoice.totals?.total_taxable || '0'),
    cgst: Number(invoice.totals?.total_cgst || '0'),
    sgst: Number(invoice.totals?.total_sgst || '0'),
    igst: Number(invoice.totals?.total_igst || '0'),
    roundOff: Number(invoice.totals?.round_off || '0'),
    total: Number(invoice.totals?.grand_total || '0'),
    terms: 'Goods once sold will not be taken back.',
  }), [invoice, partyName]);

  const shareWhatsApp = () => {
    const msg = composeInvoiceWhatsAppMessage({
      invoiceNumber: invoice.invoice_number || 'Draft',
      invoiceDate: invoice.invoice_date,
      customerName: partyName,
      totalFormatted: rupees(invoice.totals?.grand_total || '0'),
      companyName: 'Precision Moulds & Dies',
    });
    openWhatsAppShare('', msg);
  };

  // Preview renders the single chosen copy.
  const preview = async (copyType: InvoiceCopyType) => {
    setPreviewOpen(false);
    try {
      await unwrap(window.api.pdf.preview({ id: invoice.id, copyType }));
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Preview not available yet');
    }
  };

  // Export renders either one chosen copy or several copies in one PDF.
  const exportPdf = async (opts: { copyType?: InvoiceCopyType; copies?: InvoiceCopyType[] }) => {
    setExportOpen(false);
    setExporting(true);
    try {
      const path = await unwrap<string>(window.api.pdf.export({ id: invoice.id, ...opts }));
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
        <Button className="w-full" variant="outline" onClick={() => setPreviewOpen(true)}>
          <Printer className="h-4 w-4" /> Preview PDF
        </Button>
        <Button className="w-full" variant="outline" onClick={() => setThermalOpen(true)}>
          <Printer className="h-4 w-4 text-accent" /> Print Thermal (POS)
        </Button>
        <Button className="w-full" variant="outline" onClick={shareWhatsApp}>
          <Share2 className="h-4 w-4 text-emerald-600" /> Share on WhatsApp
        </Button>
        <Button className="w-full" onClick={() => setExportOpen(true)} disabled={exporting}>
          <Download className="h-4 w-4" /> {exporting ? 'Exporting…' : 'Export PDF'}
        </Button>
      </div>

      {thermalOpen && (
        <ThermalReceiptModal data={thermalData} onClose={() => setThermalOpen(false)} />
      )}

      {previewOpen && (
        <CopyPickerModal
          title="Preview PDF"
          description="Choose which copy to preview."
          confirmLabel="Preview"
          onClose={() => setPreviewOpen(false)}
          onConfirm={(copyType) => void preview(copyType)}
        />
      )}
      {exportOpen && (
        <ExportCopyModal
          onClose={() => setExportOpen(false)}
          onConfirm={(opts) => void exportPdf(opts)}
        />
      )}
    </div>
  );
}

/** Single-choice copy picker (used for Preview). */
function CopyPickerModal({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (copyType: InvoiceCopyType) => void;
}) {
  const [copyType, setCopyType] = useState<InvoiceCopyType>(InvoiceCopyType.ORIGINAL);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm(copyType)}>{confirmLabel}</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      <Field label="Copy">
        <Select value={copyType} onChange={(e) => setCopyType(e.target.value as InvoiceCopyType)}>
          {INVOICE_COPY_ORDER.map((t) => (
            <option key={t} value={t}>
              {INVOICE_COPY_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
    </Modal>
  );
}

/** Export picker: one copy (a chosen type) or multiple copies in one PDF. */
function ExportCopyModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (opts: { copyType?: InvoiceCopyType; copies?: InvoiceCopyType[] }) => void;
}) {
  const [mode, setMode] = useState<'single' | 'multiple'>('single');
  const [copyType, setCopyType] = useState<InvoiceCopyType>(InvoiceCopyType.ORIGINAL);
  const [selected, setSelected] = useState<Set<InvoiceCopyType>>(
    () => new Set<InvoiceCopyType>([InvoiceCopyType.ORIGINAL, InvoiceCopyType.DUPLICATE]),
  );

  const toggle = (t: InvoiceCopyType) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const confirm = () => {
    if (mode === 'single') {
      onConfirm({ copyType });
    } else {
      const copies = INVOICE_COPY_ORDER.filter((t) => selected.has(t));
      onConfirm({ copies: copies.length > 0 ? copies : [InvoiceCopyType.ORIGINAL] });
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Export PDF"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={mode === 'multiple' && selected.size === 0}>
            Export
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">
        Export a single copy or several copies (each on its own labelled page) in one PDF.
      </p>
      <div className="mb-4 space-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="export-copy-mode"
            checked={mode === 'single'}
            onChange={() => setMode('single')}
          />
          <span>Single copy</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="export-copy-mode"
            checked={mode === 'multiple'}
            onChange={() => setMode('multiple')}
          />
          <span>Multiple copies</span>
        </label>
      </div>

      {mode === 'single' ? (
        <Field label="Copy">
          <Select value={copyType} onChange={(e) => setCopyType(e.target.value as InvoiceCopyType)}>
            {INVOICE_COPY_ORDER.map((t) => (
              <option key={t} value={t}>
                {INVOICE_COPY_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <div className="space-y-2">
          {INVOICE_COPY_ORDER.map((t) => (
            <label key={t} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.has(t)} onChange={() => toggle(t)} />
              <span>{INVOICE_COPY_LABEL[t]}</span>
            </label>
          ))}
        </div>
      )}
    </Modal>
  );
}
