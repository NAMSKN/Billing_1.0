import { useEffect, useState } from 'react';
import { ScrollText, Download } from 'lucide-react';
import type { ProductDto } from '@shared/productDto';
import type { StockLogResponse } from '@shared/stockDto';
import {
  ITEM_TYPE_LABEL,
  STOCK_TYPE_LABEL,
  DISCOUNT_TYPE_LABEL,
  CESS_TYPE_LABEL,
  tracksStock,
} from '@shared/domain/product';
import { unwrap, ApiError } from '../lib/api';
import { rupees, formatDate, todayIso } from '../lib/format';
import { Button, Input } from '../components/ui';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

/** Read-only grouped product detail (the "View Product / Service" surface). */
export function ProductView({
  product,
  onClose,
  onOpenLog,
}: {
  product: ProductDto;
  onClose: () => void;
  onOpenLog: () => void;
}) {
  const dash = (v: string | null | undefined) => (v && v !== '' ? v : '-');
  const money = (v: string) => (Number(v) === 0 ? '-' : rupees(v));

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title="View Product / Service"
      footer={
        <>
          {tracksStock(product.item_type) && (
            <Button variant="outline" onClick={onOpenLog}>
              <ScrollText className="h-4 w-4" /> Product Log
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="space-y-5">
        <Group title="Product Detail">
          <Row label="Item Type" value={ITEM_TYPE_LABEL[product.item_type]} />
          <Row label="Name" value={product.name} />
          <Row label="Product Note" value={dash(product.note)} />
          <Row label="Barcode No." value={dash(product.barcode_no)} />
          <Row label="HSN/SAC Code" value={dash(product.hsn_sac_code)} />
          <Row label="Unit of Measurement" value={dash(product.unit_of_measurement)} />
          {tracksStock(product.item_type) && (
            <Row label="Manage Stock" value={STOCK_TYPE_LABEL[product.stock_type]} />
          )}
        </Group>

        <Group title="Pricing">
          <Row label="Sell Price" value={money(product.sell_price)} />
          <Row label="Sell Price (Incl. Tax)" value={money(product.sell_price_incl_tax)} />
          <Row
            label="Sale Discount"
            value={
              Number(product.sale_discount_value) === 0
                ? '-'
                : `${product.sale_discount_value} (${DISCOUNT_TYPE_LABEL[product.sale_discount_type]})`
            }
          />
          <Row label="Purchase Price" value={money(product.purchase_price)} />
          <Row label="Purchase Price (Incl. Tax)" value={money(product.purchase_price_incl_tax)} />
          <Row
            label="Purchase Discount"
            value={
              Number(product.purchase_discount_value) === 0
                ? '-'
                : `${product.purchase_discount_value} (${DISCOUNT_TYPE_LABEL[product.purchase_discount_type]})`
            }
          />
        </Group>

        <Group title="Tax">
          <Row label="Tax" value={Number(product.tax_rate) === 0 ? 'Nil Rated' : `${product.tax_rate}%`} />
          <Row label="CESS %" value={Number(product.cess_percent) === 0 ? '-' : `${product.cess_percent}%`} />
          <Row
            label="CESS Amount"
            value={
              Number(product.cess_amount) === 0
                ? '-'
                : `${rupees(product.cess_amount)} (${CESS_TYPE_LABEL[product.cess_type]})`
            }
          />
          <Row label="No-ITC" value={product.no_itc ? 'Yes' : '-'} />
        </Group>

        <Group title="Product Group">
          <Row label="Product Group" value={dash(product.group_name)} />
        </Group>

        <Group title="Additional Details">
          {tracksStock(product.item_type) && (
            <Row label="Low Stock Alert" value={dash(product.low_stock_alert)} />
          )}
          <Row label="Non-Sellable Product" value={product.is_sellable ? 'No' : 'Yes'} />
          <Row label="Is Manufacturing" value={product.is_manufactured ? 'Yes' : '-'} />
          <Row label="Visible on Documents" value={product.visible_on_documents ? 'Yes' : '-'} />
        </Group>
      </div>
    </Modal>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 border-b border-border pb-1 text-xs font-semibold uppercase tracking-wide text-accent">
        {title}
      </h3>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2">{children}</dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/50 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/** Product Log — the per-product stock movement history with a date filter. */
export function ProductLog({ product, onClose }: { product: ProductDto; onClose: () => void }) {
  const toast = useToast();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<StockLogResponse | null>(null);

  const search = async () => {
    try {
      const res = await unwrap<StockLogResponse>(
        window.api.stock.log({ product_id: product.id, from: from || undefined, to: to || undefined }),
      );
      setData(res);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not load log');
    }
  };

  useEffect(() => {
    void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportLog = async () => {
    try {
      const path = await unwrap<string>(
        window.api.stock.logExport({ product_id: product.id, from: from || undefined, to: to || undefined }),
      );
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-3xl"
      title={`Product Log — ${product.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={() => void exportLog()}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </>
      }
    >
      <div className="mb-4 flex items-end gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">From Date</label>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} max={todayIso()} />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">To Date</label>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} max={todayIso()} />
        </div>
        <Button onClick={() => void search()}>Search</Button>
      </div>

      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2">Transaction Date</th>
              <th className="px-3 py-2">Transaction Info</th>
              <th className="px-3 py-2">Company Name</th>
              <th className="px-3 py-2">Doc No.</th>
              <th className="px-3 py-2 text-right">Unit Price</th>
              <th className="px-3 py-2 text-right">Stock In</th>
              <th className="px-3 py-2 text-right">Stock Out</th>
              <th className="px-3 py-2">UOM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {!data || data.entries.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No stock movements in this range.
                </td>
              </tr>
            ) : (
              data.entries.map((e, i) => (
                <tr key={i}>
                  <td className="px-3 py-2 text-muted-foreground">{e.date ? formatDate(e.date) : '—'}</td>
                  <td className="px-3 py-2">{e.info}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.company_name || '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.doc_no || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.unit_price || '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-success">{e.stock_in || ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-danger">{e.stock_out || ''}</td>
                  <td className="px-3 py-2 text-muted-foreground">{e.uom}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
