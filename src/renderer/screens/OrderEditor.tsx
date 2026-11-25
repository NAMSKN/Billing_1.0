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
  FileText,
  Ban,
  CheckCheck,
} from 'lucide-react';
import type { CalcPreviewResponse, TaxRateConfigDto } from '@shared/dto';
import type { OrderDto, OrderLineDto } from '@shared/orderDto';
import type { PartyDto } from '@shared/partyDto';
import type { ProductDto } from '@shared/productDto';
import { TaxTreatment } from '@shared/domain/enums';
import { ItemType } from '@shared/domain/product';
import {
  OrderType,
  OrderStatus,
  OrderLineItemType,
  ORDER_TYPE_LABEL,
  ORDER_LINE_ITEM_TYPE_LABEL,
  orderPartyIsVendor,
} from '@shared/domain/order';
import { DiscountType } from '@shared/domain/product';
import { unwrap, ApiError } from '../lib/api';
import { rupees, todayIso } from '../lib/format';
import { Modal } from '../components/Modal';
import {
  Badge,
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
import { StateSelect } from '../components/StateSelect';
import { useToast } from '../components/Toast';
import { OrderStatusBadge } from './OrderHistory';

/**
 * Create/Edit an order (Sales Order / Purchase Order / Service Request). A
 * read-only view once confirmed/cancelled; a full editor for drafts. Totals are
 * computed live by the shared engine (calc preview over IPC). The status
 * lifecycle is enforced in the backend; the UI only calls confirm/complete/
 * cancel/convert. No E-Way Bill field is shown.
 */

function newLine(itemType: OrderLineItemType): OrderLineDto {
  return {
    id: crypto.randomUUID(),
    sequence: 0,
    item_type: itemType,
    product_id: null,
    description: '',
    hsn_sac: '',
    quantity: '1',
    unit: DEFAULT_UNIT,
    rate: '0',
    discount_percent: '0',
    tax_treatment: TaxTreatment.TAXABLE,
    tax_rate: '18',
    note: '',
    taxable_amount: null,
    cgst_amount: null,
    sgst_amount: null,
    igst_amount: null,
  };
}

function emptyOrderDto(orderType: OrderType): OrderDto {
  const defaultItemType =
    orderType === OrderType.SERVICE_REQUEST ? OrderLineItemType.SERVICE : OrderLineItemType.PRODUCT;
  return {
    id: crypto.randomUUID(),
    order_number: null,
    order_type: orderType,
    status: OrderStatus.DRAFT,
    order_date: todayIso(),
    company_id: null,
    party_id: null,
    party: {
      party_id: null,
      name: '',
      gstin: '',
      pan: '',
      phone: '',
      contact_person: '',
      address: { line: '', state_name: '', state_code: '', godown: '' },
    },
    ship_to: { line: '', state_name: '', state_code: '', godown: '' },
    place_of_supply: { state_name: '', state_code: '' },
    reverse_charge: false,
    delivery_mode: '',
    lines: [newLine(defaultItemType)],
    totals: null,
    notes: '',
    terms: '',
    document_note: '',
    template_version: null,
    converted_invoice_id: null,
    cancelled_at: '',
    cancel_reason: '',
  };
}

export function OrderEditor({
  orderId,
  orderType: newOrderType,
  onDone,
  onOpenInvoice,
}: {
  orderId: string;
  orderType?: OrderType;
  onDone: () => void;
  onOpenInvoice?: (invoiceId: string) => void;
}) {
  const toast = useToast();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [companyStateCode, setCompanyStateCode] = useState('');
  const [taxConfig, setTaxConfig] = useState<TaxRateConfigDto | null>(null);
  const [preview, setPreview] = useState<CalcPreviewResponse | null>(null);
  const [orderDate, setOrderDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerFor, setPickerFor] = useState<number | null>(null);

  const readOnly = order?.status !== OrderStatus.DRAFT;
  const isVendor = order ? orderPartyIsVendor(order.order_type) : false;
  const isServiceRequest = order?.order_type === OrderType.SERVICE_REQUEST;

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        if (orderId === 'new') {
          const type = newOrderType ?? OrderType.SALES_ORDER;
          const role = orderPartyIsVendor(type) ? 'VENDOR' : 'CUSTOMER';
          const [pty, company, settings] = await Promise.all([
            unwrap<PartyDto[]>(window.api.parties.list({ role, includeArchived: false })),
            unwrap<{ address: { state_code: string } } | null>(window.api.company.get()),
            unwrap<{ tax: TaxRateConfigDto }>(window.api.settings.get()),
          ]);
          setParties(pty);
          setCompanyStateCode(company?.address.state_code ?? '');
          setTaxConfig(settings.tax);
          setOrder(emptyOrderDto(type));
        } else {
          const o = await unwrap<OrderDto>(window.api.orders.get(orderId));
          const role = orderPartyIsVendor(o.order_type) ? 'VENDOR' : 'CUSTOMER';
          const [pty, company, settings] = await Promise.all([
            unwrap<PartyDto[]>(window.api.parties.list({ role, includeArchived: false })),
            unwrap<{ address: { state_code: string } } | null>(window.api.company.get()),
            unwrap<{ tax: TaxRateConfigDto }>(window.api.settings.get()),
          ]);
          setParties(pty);
          setCompanyStateCode(company?.address.state_code ?? '');
          setTaxConfig(settings.tax);
          setOrder(o);
          if (o.order_date) setOrderDate(o.order_date);
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Failed to load order');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const requestPreview = useCallback(async () => {
    if (!order || !taxConfig) return;
    try {
      const res = await unwrap<CalcPreviewResponse>(
        window.api.calcPreview({
          companyStateCode,
          placeOfSupplyStateCode: order.place_of_supply.state_code,
          taxConfig,
          lines: order.lines.map((l) => ({
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
  }, [order, taxConfig, companyStateCode]);

  useEffect(() => {
    void requestPreview();
  }, [requestPreview]);

  if (loading || !order) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const setOrd = (patch: Partial<OrderDto>) => setOrder((o) => (o ? { ...o, ...patch } : o));

  const setLine = (index: number, patch: Partial<OrderLineDto>) =>
    setOrder((o) => {
      if (!o) return o;
      const lines = o.lines.map((l, idx) => (idx === index ? { ...l, ...patch } : l));
      return { ...o, lines };
    });

  const addLine = () =>
    setOrder((o) => {
      if (!o) return o;
      const itemType =
        o.order_type === OrderType.SERVICE_REQUEST
          ? OrderLineItemType.SERVICE
          : OrderLineItemType.PRODUCT;
      return { ...o, lines: [...o.lines, newLine(itemType)] };
    });

  const removeLine = (index: number) =>
    setOrder((o) => (o ? { ...o, lines: o.lines.filter((_, idx) => idx !== index) } : o));

  const insertProduct = (index: number, product: ProductDto) => {
    const discountPercent =
      product.sale_discount_type === DiscountType.PERCENTAGE ? product.sale_discount_value : '0';
    const itemType =
      product.item_type === ItemType.SERVICE ? OrderLineItemType.SERVICE : OrderLineItemType.PRODUCT;
    setLine(index, {
      item_type: isServiceRequest ? OrderLineItemType.SERVICE : itemType,
      product_id: product.id,
      description: product.name,
      hsn_sac: product.hsn_sac_code,
      unit: product.unit_of_measurement || DEFAULT_UNIT,
      rate: product.sell_price,
      discount_percent: discountPercent,
      tax_rate: product.tax_rate,
    });
    setPickerFor(null);
  };

  const onSelectParty = (partyId: string) => {
    const p = parties.find((x) => x.id === partyId);
    if (!p) {
      setOrd({ party_id: null });
      return;
    }
    const addr = p.billing_address;
    const line = [addr.address1, addr.address2, addr.landmark, addr.city, addr.pincode]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
    setOrd({
      party_id: p.id,
      party: {
        party_id: p.id,
        name: p.company_name,
        gstin: p.gstin,
        pan: p.pan,
        phone: p.contact_no,
        contact_person: p.contact_person,
        address: { line, state_name: addr.state, state_code: addr.state_code, godown: '' },
      },
      place_of_supply: { state_code: addr.state_code, state_name: addr.state },
    });
  };

  const saveDraft = async () => {
    setBusy(true);
    try {
      const res = await unwrap<{ order: OrderDto }>(
        window.api.orders.saveDraft({ ...order, order_date: orderDate }),
      );
      setOrder(res.order);
      toast.success('Draft saved');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save draft');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await unwrap(window.api.orders.saveDraft({ ...order, order_date: orderDate }));
      const confirmed = await unwrap<OrderDto>(
        window.api.orders.confirm({ id: order.id, orderDate }),
      );
      setOrder(confirmed);
      toast.success(`Confirmed as ${confirmed.order_number}`);
    } catch (err) {
      if (err instanceof ApiError && err.issues?.length) {
        toast.error(err.issues[0].message);
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Failed to confirm');
      }
    } finally {
      setBusy(false);
    }
  };

  const complete = async () => {
    try {
      const done = await unwrap<OrderDto>(window.api.orders.complete(order.id));
      setOrder(done);
      toast.success('Order completed');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to complete');
    }
  };

  const cancel = async () => {
    const reason = window.prompt('Reason for cancelling this order?');
    if (reason === null) return;
    try {
      const cancelled = await unwrap<OrderDto>(
        window.api.orders.cancel({ id: order.id, reason }),
      );
      setOrder(cancelled);
      toast.info('Order cancelled');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to cancel');
    }
  };

  const convert = async () => {
    try {
      const res = await unwrap<{ invoiceId: string }>(
        window.api.orders.convertToInvoice(order.id),
      );
      toast.success('Converted to a new invoice draft');
      if (onOpenInvoice) onOpenInvoice(res.invoiceId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to convert');
    }
  };

  const previewPdf = async () => {
    try {
      await unwrap<string>(window.api.orders.pdfPreview(order.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Preview failed');
    }
  };

  const exportPdf = async () => {
    try {
      const path = await unwrap<string>(window.api.orders.pdfExport({ id: order.id }));
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const party = order.party;
  const canConvert =
    (order.status === OrderStatus.CONFIRMED || order.status === OrderStatus.COMPLETED) &&
    order.order_type !== OrderType.PURCHASE_ORDER;

  return (
    <div>
      <PageHeader
        title={order.order_number ?? `Create ${ORDER_TYPE_LABEL[order.order_type]}`}
        copyText={order.order_number ?? undefined}
        description={
          readOnly
            ? `This ${ORDER_TYPE_LABEL[order.order_type].toLowerCase()} is ${order.status.toLowerCase()}.`
            : 'Draft — editable until confirmed.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <OrderStatusBadge status={order.status} />
          </div>
        }
      />

      <div className="grid grid-cols-[1fr_340px] gap-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{isVendor ? 'Vendor Information' : 'Customer Information'}</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="M/S (Party)" className="col-span-2">
                <Select
                  value={order.party_id ?? ''}
                  onChange={(e) => onSelectParty(e.target.value)}
                  disabled={readOnly}
                >
                  <option value="">
                    {isVendor ? 'Select vendor…' : 'Select customer…'}
                  </option>
                  {parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.company_name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Address" className="col-span-2">
                <Textarea value={party.address.line} readOnly rows={2} />
              </Field>

              <Field label="Contact Person">
                <Input
                  value={party.contact_person}
                  onChange={(e) => setOrd({ party: { ...party, contact_person: e.target.value } })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Phone No">
                <Input
                  value={party.phone}
                  onChange={(e) => setOrd({ party: { ...party, phone: e.target.value } })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="GSTIN / PAN">
                <Input value={party.gstin || party.pan} readOnly />
              </Field>
              <Field label="Rev. Charge">
                <Select
                  value={order.reverse_charge ? 'YES' : 'NO'}
                  onChange={(e) => setOrd({ reverse_charge: e.target.value === 'YES' })}
                  disabled={readOnly}
                >
                  <option value="NO">No</option>
                  <option value="YES">Yes</option>
                </Select>
              </Field>

              <Field label="Place of Supply" className="col-span-2">
                <StateSelect
                  code={order.place_of_supply.state_code}
                  onChange={(state_code, state_name) =>
                    setOrd({ place_of_supply: { state_code, state_name } })
                  }
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{ORDER_TYPE_LABEL[order.order_type]} Detail</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <Input value={ORDER_TYPE_LABEL[order.order_type]} readOnly />
              </Field>
              <Field label="Order No.">
                <Input value={order.order_number ?? 'Auto (on confirm)'} readOnly />
              </Field>
              <Field label="Order Date">
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                  disabled={readOnly}
                  max={todayIso()}
                />
              </Field>
              <Field label="Delivery Mode">
                <Input
                  value={order.delivery_mode}
                  onChange={(e) => setOrd({ delivery_mode: e.target.value })}
                  placeholder="Select delivery mode"
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Product Items</CardTitle>
                {!readOnly && (
                  <Button variant="outline" size="sm" onClick={addLine}>
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardBody className="space-y-3">
              {order.lines.map((line, index) => (
                <LineRow
                  key={line.id}
                  line={line}
                  index={index}
                  readOnly={readOnly}
                  serviceOnly={isServiceRequest}
                  amount={preview?.lines[index]?.amount}
                  tax={preview?.lines[index]}
                  interState={preview?.tax_type === 'INTER_STATE'}
                  onChange={(patch) => setLine(index, patch)}
                  onRemove={() => removeLine(index)}
                  canRemove={order.lines.length > 1}
                  onPick={() => setPickerFor(index)}
                  onEnter={addLine}
                />
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Terms &amp; Notes</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <Field label="Terms & Conditions">
                <Textarea
                  value={order.terms}
                  onChange={(e) => setOrd({ terms: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={order.notes}
                  onChange={(e) => setOrd({ notes: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Document Note / Remarks (not printed)">
                <Textarea
                  value={order.document_note}
                  onChange={(e) => setOrd({ document_note: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
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
              <Button className="w-full" onClick={() => void confirm()} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" /> Confirm Order
              </Button>
            </div>
          ) : order.status === OrderStatus.CANCELLED ? (
            <Card>
              <CardBody className="text-sm text-muted-foreground">
                Cancelled on {order.cancelled_at.slice(0, 10)}.
                {order.cancel_reason && <div className="mt-1">Reason: {order.cancel_reason}</div>}
              </CardBody>
            </Card>
          ) : (
            <div className="space-y-2">
              {order.status === OrderStatus.CONFIRMED && (
                <Button className="w-full" onClick={() => void complete()}>
                  <CheckCheck className="h-4 w-4" /> Mark Completed
                </Button>
              )}
              {canConvert && (
                <Button className="w-full" variant="outline" onClick={() => void convert()}>
                  <FileText className="h-4 w-4" /> Convert to Invoice
                </Button>
              )}
              <Button className="w-full" variant="outline" onClick={() => void previewPdf()}>
                <Printer className="h-4 w-4" /> Preview PDF
              </Button>
              <Button className="w-full" variant="outline" onClick={() => void exportPdf()}>
                <Download className="h-4 w-4" /> Export PDF
              </Button>
              {order.status === OrderStatus.CONFIRMED && (
                <Button className="w-full" variant="danger" onClick={() => void cancel()}>
                  <Ban className="h-4 w-4" /> Cancel Order
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {pickerFor !== null && (
        <ProductPickerModal
          serviceOnly={isServiceRequest}
          onClose={() => setPickerFor(null)}
          onPick={(p) => insertProduct(pickerFor, p)}
        />
      )}
    </div>
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
  serviceOnly,
  amount,
  tax,
  interState,
  onChange,
  onRemove,
  canRemove,
  onPick,
  onEnter,
}: {
  line: OrderLineDto;
  index: number;
  readOnly: boolean;
  serviceOnly: boolean;
  amount?: string;
  tax?: { cgst: string; sgst: string; igst: string };
  interState?: boolean;
  onChange: (patch: Partial<OrderLineDto>) => void;
  onRemove: () => void;
  canRemove: boolean;
  onPick: () => void;
  onEnter: () => void;
}) {
  const rateRef = useRef<HTMLInputElement>(null);
  const taxDisplay = interState ? tax?.igst : tax ? String(Number(tax.cgst) + Number(tax.sgst)) : undefined;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">SR {index + 1}</span>
          {serviceOnly ? (
            <Badge tone="neutral">Service</Badge>
          ) : (
            <Select
              className="h-7 w-28 text-xs"
              value={line.item_type}
              onChange={(e) =>
                onChange({ item_type: e.target.value as OrderLineItemType, product_id: null })
              }
              disabled={readOnly}
            >
              {Object.values(OrderLineItemType).map((t) => (
                <option key={t} value={t}>
                  {ORDER_LINE_ITEM_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={onPick}>
              <PackageSearch className="h-3.5 w-3.5" /> Pick
            </Button>
          )}
          {!readOnly && canRemove && (
            <Button variant="ghost" size="sm" onClick={onRemove}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12">
          <Input
            placeholder={line.item_type === OrderLineItemType.SERVICE ? 'Service description' : 'Product name'}
            value={line.description}
            onChange={(e) => onChange({ description: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <div className="col-span-12">
          <Input
            placeholder="Item note (optional)"
            value={line.note}
            onChange={(e) => onChange({ note: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <div className="col-span-3">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">HSN/SAC</label>
          <Input value={line.hsn_sac} onChange={(e) => onChange({ hsn_sac: e.target.value })} disabled={readOnly} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Qty</label>
          <Input
            inputMode="decimal"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">UOM</label>
          <UnitSelect value={line.unit} onChange={(unit) => onChange({ unit })} disabled={readOnly} />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Price</label>
          <Input
            ref={rateRef}
            inputMode="decimal"
            value={line.rate}
            onChange={(e) => onChange({ rate: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onEnter()}
            disabled={readOnly}
          />
        </div>
        <div className="col-span-3">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Discount %</label>
          <Input
            inputMode="decimal"
            value={line.discount_percent}
            onChange={(e) => onChange({ discount_percent: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <div className="col-span-4">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">
            {interState ? 'IGST' : 'GST'}
          </label>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm tabular-nums text-muted-foreground">
            {rupees(taxDisplay)}
          </div>
        </div>
        <div className="col-span-8">
          <label className="mb-1 block text-[10px] uppercase text-muted-foreground">Total</label>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-right text-sm font-medium tabular-nums">
            {rupees(amount)}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductPickerModal({
  serviceOnly,
  onClose,
  onPick,
}: {
  serviceOnly: boolean;
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
    let list = products;
    if (serviceOnly) list = list.filter((p) => p.item_type === ItemType.SERVICE);
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.hsn_sac_code.toLowerCase().includes(needle) ||
        p.barcode_no.toLowerCase().includes(needle),
    );
  }, [products, query, serviceOnly]);

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title="Select from Catalogue">
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
          {serviceOnly ? 'No services found.' : 'No items found.'}
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
                    {p.item_type === ItemType.SERVICE ? 'Service' : 'Product'}
                    {p.hsn_sac_code ? ` · HSN/SAC ${p.hsn_sac_code}` : ''}
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
