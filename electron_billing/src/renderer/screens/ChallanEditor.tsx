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
import type { CalcPreviewResponse, TaxRateConfigDto } from '@shared/dto';
import type { ChallanDto, ChallanLineDto } from '@shared/challanDto';
import type { PartyDto } from '@shared/partyDto';
import type { ProductDto } from '@shared/productDto';
import { InvoiceStatus, TaxTreatment } from '@shared/domain/enums';
import {
  ChallanDirection,
  ChallanType,
  CHALLAN_DIRECTION_LABEL,
  CHALLAN_TYPE_LABEL,
} from '@shared/domain/challan';
import { DiscountType, ITEM_TYPE_LABEL } from '@shared/domain/product';
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
import { StatusBadge } from '../components/badges';
import { StateSelect } from '../components/StateSelect';
import { useToast } from '../components/Toast';

/**
 * Create/Edit Delivery Challan. A read-only view for finalized / cancelled
 * challans; a full editor for drafts. Totals are computed live by the shared
 * calculation engine (calc preview over IPC); the UI never does money math.
 */

function newLine(): ChallanLineDto {
  return {
    id: crypto.randomUUID(),
    sequence: 0,
    description: '',
    hsn_sac: '',
    quantity: '1',
    unit: 'NOS',
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

/** A fresh, unsaved draft built entirely client-side (persisted on Save). */
function emptyChallanDto(): ChallanDto {
  return {
    id: crypto.randomUUID(),
    challan_number: null,
    status: InvoiceStatus.DRAFT,
    direction: ChallanDirection.OUTWARD,
    challan_type: ChallanType.OTHER,
    challan_date: todayIso(),
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
    reason_for_eway: '',
    delivery_mode: '',
    vehicle_no: '',
    lines: [newLine()],
    totals: null,
    notes: '',
    terms: '',
    document_note: '',
    template_version: null,
    cancelled_at: '',
    cancel_reason: '',
  };
}

export function ChallanEditor({
  challanId,
  onDone,
}: {
  challanId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [challan, setChallan] = useState<ChallanDto | null>(null);
  const [parties, setParties] = useState<PartyDto[]>([]);
  const [companyStateCode, setCompanyStateCode] = useState('');
  const [taxConfig, setTaxConfig] = useState<TaxRateConfigDto | null>(null);
  const [preview, setPreview] = useState<CalcPreviewResponse | null>(null);
  const [challanDate, setChallanDate] = useState(todayIso());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const readOnly = challan?.status !== InvoiceStatus.DRAFT;

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const [pty, company, settings] = await Promise.all([
          unwrap<PartyDto[]>(window.api.parties.list({ role: 'ALL', includeArchived: false })),
          unwrap<{ address: { state_code: string } } | null>(window.api.company.get()),
          unwrap<{ tax: TaxRateConfigDto }>(window.api.settings.get()),
        ]);
        setParties(pty);
        setCompanyStateCode(company?.address.state_code ?? '');
        setTaxConfig(settings.tax);

        if (challanId === 'new') {
          // Build the draft in-memory only; it is persisted on Save/Finalize so
          // merely visiting "New Challan" never leaves a blank draft behind.
          setChallan(emptyChallanDto());
        } else {
          const c = await unwrap<ChallanDto>(window.api.challans.get(challanId));
          setChallan(c);
          if (c.challan_date) setChallanDate(c.challan_date);
        }
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Failed to load challan');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challanId]);

  const requestPreview = useCallback(async () => {
    if (!challan || !taxConfig) return;
    try {
      const res = await unwrap<CalcPreviewResponse>(
        window.api.calcPreview({
          companyStateCode,
          placeOfSupplyStateCode: challan.place_of_supply.state_code,
          taxConfig,
          lines: challan.lines.map((l) => ({
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
  }, [challan, taxConfig, companyStateCode]);

  useEffect(() => {
    void requestPreview();
  }, [requestPreview]);

  if (loading || !challan) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const setCh = (patch: Partial<ChallanDto>) => setChallan((c) => (c ? { ...c, ...patch } : c));

  const setLine = (index: number, patch: Partial<ChallanLineDto>) =>
    setChallan((c) => {
      if (!c) return c;
      const lines = c.lines.map((l, idx) => (idx === index ? { ...l, ...patch } : l));
      return { ...c, lines };
    });

  const addLine = () => setChallan((c) => (c ? { ...c, lines: [...c.lines, newLine()] } : c));
  const removeLine = (index: number) =>
    setChallan((c) => (c ? { ...c, lines: c.lines.filter((_, idx) => idx !== index) } : c));

  const insertProduct = (product: ProductDto) => {
    const discountPercent =
      product.sale_discount_type === DiscountType.PERCENTAGE ? product.sale_discount_value : '0';
    const line: ChallanLineDto = {
      ...newLine(),
      description: product.name,
      hsn_sac: product.hsn_sac_code,
      unit: product.unit_of_measurement,
      quantity: '1',
      rate: product.sell_price,
      discount_percent: discountPercent,
      tax_rate: product.tax_rate,
    };
    setChallan((c) => (c ? { ...c, lines: [...c.lines, line] } : c));
    setPickerOpen(false);
  };

  const onSelectParty = (partyId: string) => {
    const p = parties.find((x) => x.id === partyId);
    if (!p) {
      setCh({ party_id: null });
      return;
    }
    const addr = p.billing_address;
    const line = [addr.address1, addr.address2, addr.landmark, addr.city, addr.pincode]
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ');
    setCh({
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
      const res = await unwrap<{ challan: ChallanDto }>(
        window.api.challans.saveDraft({ ...challan, challan_date: challanDate }),
      );
      setChallan(res.challan);
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
      await unwrap(window.api.challans.saveDraft({ ...challan, challan_date: challanDate }));
      const finalized = await unwrap<ChallanDto>(
        window.api.challans.finalize({ id: challan.id, challanDate }),
      );
      setChallan(finalized);
      toast.success(`Finalized as ${finalized.challan_number}`);
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

  const previewPdf = async () => {
    try {
      await unwrap<string>(window.api.challans.pdfPreview(challan.id));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Preview failed');
    }
  };

  const exportPdf = async () => {
    try {
      const path = await unwrap<string>(window.api.challans.pdfExport({ id: challan.id }));
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const party = challan.party;

  return (
    <div>
      <PageHeader
        title={challan.challan_number ?? (readOnly ? 'Challan' : 'Create Challan')}
        description={
          readOnly
            ? 'This delivery challan is a finalized historical record.'
            : 'Draft — editable until finalized.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onDone}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <StatusBadge status={challan.status} />
          </div>
        }
      />

      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Customer Information</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Supply Type" className="col-span-2">
                <div className="flex items-center gap-6 pt-1">
                  {[ChallanDirection.OUTWARD, ChallanDirection.INWARD].map((dir) => (
                    <label key={dir} className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="direction"
                        className="h-4 w-4 accent-accent"
                        checked={challan.direction === dir}
                        disabled={readOnly}
                        onChange={() => setCh({ direction: dir })}
                      />
                      {CHALLAN_DIRECTION_LABEL[dir]}
                    </label>
                  ))}
                </div>
              </Field>

              <Field label="M/S (Party)" className="col-span-2">
                <Select
                  value={challan.party_id ?? ''}
                  onChange={(e) => onSelectParty(e.target.value)}
                  disabled={readOnly}
                >
                  <option value="">Select customer / vendor…</option>
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
                  onChange={(e) => setCh({ party: { ...party, contact_person: e.target.value } })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Phone No">
                <Input
                  value={party.phone}
                  onChange={(e) => setCh({ party: { ...party, phone: e.target.value } })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="GSTIN / PAN">
                <Input value={party.gstin || party.pan} readOnly />
              </Field>
              <Field label="Rev. Charge">
                <Select
                  value={challan.reverse_charge ? 'YES' : 'NO'}
                  onChange={(e) => setCh({ reverse_charge: e.target.value === 'YES' })}
                  disabled={readOnly}
                >
                  <option value="NO">No</option>
                  <option value="YES">Yes</option>
                </Select>
              </Field>

              <Field label="Place of Supply" className="col-span-2">
                <StateSelect
                  code={challan.place_of_supply.state_code}
                  onChange={(state_code, state_name) =>
                    setCh({ place_of_supply: { state_code, state_name } })
                  }
                />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Challan Detail</CardTitle>
            </CardHeader>
            <CardBody className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <Select
                  value={challan.challan_type}
                  onChange={(e) => setCh({ challan_type: e.target.value as ChallanType })}
                  disabled={readOnly}
                >
                  {Object.values(ChallanType).map((t) => (
                    <option key={t} value={t}>
                      {CHALLAN_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Challan No.">
                <Input value={challan.challan_number ?? 'Auto (on finalize)'} readOnly />
              </Field>
              <Field label="Challan Date">
                <Input
                  type="date"
                  value={challanDate}
                  onChange={(e) => setChallanDate(e.target.value)}
                  disabled={readOnly}
                  max={todayIso()}
                />
              </Field>
              <Field label="Reason For E-Way">
                <Input
                  value={challan.reason_for_eway}
                  onChange={(e) => setCh({ reason_for_eway: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Delivery Mode">
                <Input
                  value={challan.delivery_mode}
                  onChange={(e) => setCh({ delivery_mode: e.target.value })}
                  placeholder="Select delivery mode"
                  disabled={readOnly}
                />
              </Field>
              <Field label="Motor Vehicle No.">
                <Input
                  value={challan.vehicle_no}
                  onChange={(e) => setCh({ vehicle_no: e.target.value })}
                  placeholder="e.g. MH12AB1234"
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
              {challan.lines.map((line, index) => (
                <LineRow
                  key={line.id}
                  line={line}
                  index={index}
                  readOnly={readOnly}
                  amount={preview?.lines[index]?.amount}
                  tax={preview?.lines[index]}
                  interState={preview?.tax_type === 'INTER_STATE'}
                  onChange={(patch) => setLine(index, patch)}
                  onRemove={() => removeLine(index)}
                  canRemove={challan.lines.length > 1}
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
                  value={challan.terms}
                  onChange={(e) => setCh({ terms: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Notes">
                <Textarea
                  value={challan.notes}
                  onChange={(e) => setCh({ notes: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
              <Field label="Document Note / Remarks (not printed)">
                <Textarea
                  value={challan.document_note}
                  onChange={(e) => setCh({ document_note: e.target.value })}
                  disabled={readOnly}
                />
              </Field>
            </CardBody>
          </Card>
        </div>

        {/* Right column: totals + actions */}
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
              <Button className="w-full" onClick={() => void finalize()} disabled={busy}>
                <CheckCircle2 className="h-4 w-4" /> Finalize Challan
              </Button>
            </div>
          ) : challan.status === InvoiceStatus.FINALIZED ? (
            <div className="space-y-2">
              <Button className="w-full" variant="outline" onClick={() => void previewPdf()}>
                <Printer className="h-4 w-4" /> Preview PDF
              </Button>
              <Button className="w-full" variant="outline" onClick={() => void exportPdf()}>
                <Download className="h-4 w-4" /> Export PDF
              </Button>
            </div>
          ) : (
            <Card>
              <CardBody className="text-sm text-muted-foreground">
                Cancelled on {challan.cancelled_at.slice(0, 10)}.
                {challan.cancel_reason && <div className="mt-1">Reason: {challan.cancel_reason}</div>}
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
  tax,
  interState,
  onChange,
  onRemove,
  canRemove,
  onEnter,
}: {
  line: ChallanLineDto;
  index: number;
  readOnly: boolean;
  amount?: string;
  tax?: { cgst: string; sgst: string; igst: string };
  interState?: boolean;
  onChange: (patch: Partial<ChallanLineDto>) => void;
  onRemove: () => void;
  canRemove: boolean;
  onEnter: () => void;
}) {
  const rateRef = useRef<HTMLInputElement>(null);
  const taxDisplay = interState ? tax?.igst : tax ? String(Number(tax.cgst) + Number(tax.sgst)) : undefined;
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">SR {index + 1}</span>
        {!readOnly && canRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="grid grid-cols-12 gap-2">
        <div className="col-span-12">
          <Input
            placeholder="Product / description"
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
          <Input value={line.unit} onChange={(e) => onChange({ unit: e.target.value })} disabled={readOnly} />
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
          {products.length === 0 ? 'No sellable products yet.' : 'No matches.'}
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
