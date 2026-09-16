import { useEffect, useState } from 'react';
import type { ProductDto, ProductGroupDto } from '@shared/productDto';
import {
  ItemType,
  StockType,
  DiscountType,
  CessType,
  ITEM_TYPE_LABEL,
  STOCK_TYPE_LABEL,
  DISCOUNT_TYPE_LABEL,
  CESS_TYPE_LABEL,
  tracksStock,
} from '@shared/domain/product';
import { unwrap, ApiError } from '../lib/api';
import { Button, Field, Input, Select, Textarea } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

export function emptyProduct(): ProductDto {
  return {
    id: '',
    item_type: ItemType.PRODUCT,
    name: '',
    note: '',
    barcode_no: '',
    hsn_sac_code: '',
    unit_of_measurement: '',
    tax_rate: '0',
    cess_percent: '0',
    cess_type: CessType.FIXED,
    cess_amount: '0',
    no_itc: false,
    sell_price: '0',
    sell_price_incl_tax: '0',
    sale_discount_type: DiscountType.RUPEE,
    sale_discount_value: '0',
    purchase_price: '0',
    purchase_price_incl_tax: '0',
    purchase_discount_type: DiscountType.RUPEE,
    purchase_discount_value: '0',
    stock_type: StockType.NORMAL,
    opening_qty: null,
    low_stock_alert: null,
    product_group_id: null,
    image_asset_id: null,
    is_manufactured: false,
    is_sellable: true,
    visible_on_documents: false,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </div>
  );
}

export function ProductEditor({
  product,
  onClose,
  onSaved,
}: {
  product: ProductDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<ProductDto>(product);
  const [groups, setGroups] = useState<ProductGroupDto[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setGroups(await unwrap<ProductGroupDto[]>(window.api.products.groupList()));
      } catch {
        /* optional */
      }
    })();
  }, []);

  const set = (patch: Partial<ProductDto>) => setDraft((d) => ({ ...d, ...patch }));
  const isProduct = tracksStock(draft.item_type);

  const save = async () => {
    setSaving(true);
    try {
      await unwrap(window.api.products.save(draft));
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={product.id ? 'Edit Item' : 'Add Product / Service'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Section title="Basic Information">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Item Type *">
              <Select
                value={draft.item_type}
                onChange={(e) => set({ item_type: e.target.value as ItemType })}
              >
                {Object.values(ItemType).map((t) => (
                  <option key={t} value={t}>
                    {ITEM_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={isProduct ? 'Unit of Measurement *' : 'Unit of Measurement'}>
              <Input
                value={draft.unit_of_measurement}
                onChange={(e) => set({ unit_of_measurement: e.target.value })}
                placeholder="PCS, KG, HRS…"
              />
            </Field>
            <Field label="Name *" className="col-span-2">
              <Input value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
            </Field>
            <Field label="HSN/SAC Code">
              <Input value={draft.hsn_sac_code} onChange={(e) => set({ hsn_sac_code: e.target.value })} />
            </Field>
            <Field label="Barcode No.">
              <Input value={draft.barcode_no} onChange={(e) => set({ barcode_no: e.target.value })} />
            </Field>
            <Field label="Product Note" className="col-span-2">
              <Textarea value={draft.note} onChange={(e) => set({ note: e.target.value })} />
            </Field>
            <Field label="Group">
              <Select
                value={draft.product_group_id ?? ''}
                onChange={(e) => set({ product_group_id: e.target.value || null })}
              >
                <option value="">— No Group —</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Section>

        <Section title="Tax">
          <div className="grid grid-cols-4 gap-4">
            <Field label="Tax %">
              <Input value={draft.tax_rate} onChange={(e) => set({ tax_rate: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="CESS %">
              <Input value={draft.cess_percent} onChange={(e) => set({ cess_percent: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="CESS Type">
              <Select value={draft.cess_type} onChange={(e) => set({ cess_type: e.target.value as CessType })}>
                {Object.values(CessType).map((t) => (
                  <option key={t} value={t}>
                    {CESS_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="CESS Amount">
              <Input value={draft.cess_amount} onChange={(e) => set({ cess_amount: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.no_itc} onChange={(e) => set({ no_itc: e.target.checked })} className="h-4 w-4 accent-accent" />
            No ITC
          </label>
        </Section>

        <Section title="Sales Pricing">
          <div className="grid grid-cols-4 gap-4">
            <Field label="Sell Price">
              <Input value={draft.sell_price} onChange={(e) => set({ sell_price: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Sell Price (Incl. Tax)">
              <Input value={draft.sell_price_incl_tax} onChange={(e) => set({ sell_price_incl_tax: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Discount Type">
              <Select value={draft.sale_discount_type} onChange={(e) => set({ sale_discount_type: e.target.value as DiscountType })}>
                {Object.values(DiscountType).map((t) => (
                  <option key={t} value={t}>
                    {DISCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Discount">
              <Input value={draft.sale_discount_value} onChange={(e) => set({ sale_discount_value: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
        </Section>

        <Section title="Purchase Pricing">
          <div className="grid grid-cols-4 gap-4">
            <Field label="Purchase Price">
              <Input value={draft.purchase_price} onChange={(e) => set({ purchase_price: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Purchase Price (Incl. Tax)">
              <Input value={draft.purchase_price_incl_tax} onChange={(e) => set({ purchase_price_incl_tax: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label="Discount Type">
              <Select value={draft.purchase_discount_type} onChange={(e) => set({ purchase_discount_type: e.target.value as DiscountType })}>
                {Object.values(DiscountType).map((t) => (
                  <option key={t} value={t}>
                    {DISCOUNT_TYPE_LABEL[t]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Discount">
              <Input value={draft.purchase_discount_value} onChange={(e) => set({ purchase_discount_value: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
        </Section>

        {isProduct && (
          <Section title="Stock (Products only)">
            <div className="grid grid-cols-3 gap-4">
              <Field label="Stock Type">
                <Select value={draft.stock_type} onChange={(e) => set({ stock_type: e.target.value as StockType })}>
                  {Object.values(StockType).map((t) => (
                    <option key={t} value={t}>
                      {STOCK_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Available Qty">
                <Input
                  value={draft.opening_qty ?? ''}
                  onChange={(e) => set({ opening_qty: e.target.value || null })}
                  inputMode="decimal"
                  placeholder="Optional"
                />
              </Field>
              <Field label="Low Stock Alert">
                <Input
                  value={draft.low_stock_alert ?? ''}
                  onChange={(e) => set({ low_stock_alert: e.target.value || null })}
                  inputMode="decimal"
                  placeholder="Optional"
                />
              </Field>
            </div>
          </Section>
        )}

        <Section title="Flags">
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.is_manufactured} onChange={(e) => set({ is_manufactured: e.target.checked })} className="h-4 w-4 accent-accent" />
              Manufacturing
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={!draft.is_sellable} onChange={(e) => set({ is_sellable: !e.target.checked })} className="h-4 w-4 accent-accent" />
              Non-sellable (hide from new invoices)
            </label>
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={draft.visible_on_documents} onChange={(e) => set({ visible_on_documents: e.target.checked })} className="h-4 w-4 accent-accent" />
              Visible on documents
            </label>
          </div>
        </Section>
      </div>
    </Modal>
  );
}
