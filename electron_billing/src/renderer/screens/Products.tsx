import { useEffect, useState, type ReactNode } from 'react';
import { Plus, Package, Search, Pencil, Archive, Upload, Download, Layers, Trash2, Eye } from 'lucide-react';
import type {
  ProductDto,
  ProductGroupDto,
  ProductListRequest,
  ProductImportPreviewDto,
  ProductImportResultDto,
  ProductImportAsDto,
} from '@shared/productDto';
import { ItemType, ITEM_TYPE_LABEL, STOCK_TYPE_LABEL, tracksStock } from '@shared/domain/product';
import { unwrap, ApiError } from '../lib/api';
import { rupees } from '../lib/format';
import { Button, Card, Input, Select, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useColumnPrefs, type ColumnDef } from '../lib/useColumnPrefs';
import { ColumnChooser } from '../components/ColumnChooser';
import { ProductEditor, emptyProduct } from './ProductEditor';
import { ProductView, ProductLog } from './ProductView';

type ItemFilter = 'ALL' | ItemType;

/** Column catalogue for the product table (Name + Actions locked). */
const PRODUCT_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', locked: true },
  { key: 'type', label: 'Type' },
  { key: 'hsn_sac', label: 'HSN/SAC' },
  { key: 'unit', label: 'Unit' },
  { key: 'sell_price', label: 'Sell Price' },
  { key: 'sell_price_incl', label: 'Sell Price (Incl. Tax)', defaultVisible: false },
  { key: 'purchase_price', label: 'Purchase Price' },
  { key: 'purchase_price_incl', label: 'Purchase Price (Incl. Tax)', defaultVisible: false },
  { key: 'tax', label: 'Tax %' },
  { key: 'stock', label: 'Stock' },
  { key: 'group', label: 'Group' },
  { key: 'note', label: 'Product Note', defaultVisible: false },
  { key: 'barcode', label: 'Barcode', defaultVisible: false },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', locked: true },
];

function productCell(
  p: ProductDto,
  key: string,
  onEdit: () => void,
  onArchive: () => void,
  onView: () => void,
): ReactNode {
  switch (key) {
    case 'name':
      return <span className="font-medium">{p.name}</span>;
    case 'type':
      return (
        <Badge tone={p.item_type === ItemType.PRODUCT ? 'accent' : 'neutral'}>
          {ITEM_TYPE_LABEL[p.item_type]}
        </Badge>
      );
    case 'hsn_sac':
      return <span className="font-mono text-xs">{p.hsn_sac_code || '—'}</span>;
    case 'unit':
      return <span className="text-muted-foreground">{p.unit_of_measurement || '—'}</span>;
    case 'sell_price':
      return <span className="tabular-nums">{rupees(p.sell_price)}</span>;
    case 'sell_price_incl':
      return <span className="tabular-nums text-muted-foreground">{rupees(p.sell_price_incl_tax)}</span>;
    case 'purchase_price':
      return <span className="tabular-nums text-muted-foreground">{rupees(p.purchase_price)}</span>;
    case 'purchase_price_incl':
      return <span className="tabular-nums text-muted-foreground">{rupees(p.purchase_price_incl_tax)}</span>;
    case 'tax':
      return <span className="tabular-nums">{p.tax_rate}%</span>;
    case 'stock':
      return (
        <span className="text-xs text-muted-foreground">
          {tracksStock(p.item_type)
            ? `${p.opening_qty ?? '—'}${p.opening_qty ? ` (${STOCK_TYPE_LABEL[p.stock_type]})` : ''}`
            : '—'}
        </span>
      );
    case 'group':
      return <span className="text-muted-foreground">{p.group_name || '—'}</span>;
    case 'note':
      return <span className="text-muted-foreground">{p.note || '—'}</span>;
    case 'barcode':
      return <span className="font-mono text-xs">{p.barcode_no || '—'}</span>;
    case 'status':
      return p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Archived</Badge>;
    case 'actions':
      return (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={onView}>
            <Eye className="h-3.5 w-3.5" /> View
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> Edit
          </Button>
          {p.is_active && (
            <Button variant="ghost" size="sm" onClick={onArchive}>
              <Archive className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      );
    default:
      return null;
  }
}

export function Products() {
  const toast = useToast();
  const [rows, setRows] = useState<ProductDto[]>([]);
  const [groups, setGroups] = useState<ProductGroupDto[]>([]);
  const [itemFilter, setItemFilter] = useState<ItemFilter>('ALL');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [showArchived, setShowArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<ProductDto | null>(null);
  const [viewing, setViewing] = useState<ProductDto | null>(null);
  const [logging, setLogging] = useState<ProductDto | null>(null);
  const [manageGroups, setManageGroups] = useState(false);
  const [importResult, setImportResult] = useState<ProductImportPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const columns = useColumnPrefs('products', PRODUCT_COLUMNS);

  const loadGroups = async () => setGroups(await unwrap<ProductGroupDto[]>(window.api.products.groupList()));

  const load = async () => {
    const req: ProductListRequest = {
      itemType: itemFilter === 'ALL' ? 'ALL' : (itemFilter as ItemType),
      includeArchived: showArchived,
      groupId: groupFilter === 'ALL' ? null : groupFilter,
      search: query.trim() || undefined,
    };
    setRows(await unwrap<ProductDto[]>(window.api.products.list(req)));
    setLoading(false);
  };

  useEffect(() => {
    void loadGroups();
  }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemFilter, groupFilter, showArchived, query]);

  const archive = async (p: ProductDto) => {
    if (!window.confirm(`Archive '${p.name}'? It stays for historical documents but is hidden from new ones.`)) return;
    await unwrap(window.api.products.archive(p.id));
    toast.info(`Archived ${p.name}`);
    void load();
  };

  const doExport = async (scope: 'PRODUCTS' | 'SERVICES' | 'ADDITIONAL_CHARGES' | 'ALL') => {
    try {
      const path = await unwrap<string>(window.api.products.export({ scope, includeArchived: showArchived }));
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const startImport = async (importAs: ProductImportAsDto) => {
    try {
      const preview = await unwrap<ProductImportPreviewDto>(window.api.products.importPreview({ importAs }));
      if (preview.header_errors.length) {
        toast.error(preview.header_errors[0]);
        return;
      }
      setImportResult(preview);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Could not read file');
    }
  };

  return (
    <div>
      <PageHeader
        title="Products / Services"
        description="Your catalogue of products, services, and additional charges."
        actions={
          <div className="flex items-center gap-2">
            <ColumnChooser prefs={columns} />
            <Button variant="outline" onClick={() => setManageGroups(true)}>
              <Layers className="h-4 w-4" /> Groups
            </Button>
            <Dropdown label="Import Excel" icon={<Upload className="h-4 w-4" />} items={[
              ['FILE', "Use file's Item Type"],
              ['PRODUCT', 'Import all as Products'],
              ['SERVICE', 'Import all as Services'],
              ['ADDITIONAL_CHARGES', 'Import all as Additional Charges'],
            ]} onPick={(v) => void startImport(v as ProductImportAsDto)} />
            <Dropdown label="Export Excel" icon={<Download className="h-4 w-4" />} items={[
              ['ALL', 'All items'],
              ['PRODUCTS', 'Products only'],
              ['SERVICES', 'Services only'],
              ['ADDITIONAL_CHARGES', 'Additional charges'],
            ]} onPick={(v) => void doExport(v as 'PRODUCTS' | 'SERVICES' | 'ADDITIONAL_CHARGES' | 'ALL')} />
            <Button onClick={() => setEditing(emptyProduct())}>
              <Plus className="h-4 w-4" /> Add Product
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Select className="w-40" value={itemFilter} onChange={(e) => setItemFilter(e.target.value as ItemFilter)}>
          <option value="ALL">All types</option>
          {Object.values(ItemType).map((t) => (
            <option key={t} value={t}>{ITEM_TYPE_LABEL[t]}</option>
          ))}
        </Select>
        <Select className="w-44" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="ALL">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, barcode, or HSN/SAC" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-accent" />
          Show archived
        </label>
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Package className="h-8 w-8" />}
          title={query ? 'No matches' : 'No products or services yet'}
          description={query ? 'Try a different search.' : 'Add one, or import from Excel.'}
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                {columns.visible.map((c) => (
                  <th
                    key={c.key}
                    className={`px-4 py-3 font-medium ${c.key === 'actions' ? 'text-right' : ''}`}
                  >
                    {c.key === 'actions' ? 'Actions' : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => (
                <tr key={p.id} className="cursor-pointer transition-colors hover:bg-muted/40" onDoubleClick={() => setEditing(p)}>
                  {columns.visible.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.key === 'actions' ? 'text-right' : ''}`}>
                      {productCell(p, c.key, () => setEditing(p), () => void archive(p), () => setViewing(p))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">{rows.length} item(s).</div>
        </Card>
      )}

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            toast.success('Item saved');
          }}
        />
      )}

      {viewing && (
        <ProductView
          product={viewing}
          onClose={() => setViewing(null)}
          onOpenLog={() => {
            setLogging(viewing);
            setViewing(null);
          }}
        />
      )}

      {logging && <ProductLog product={logging} onClose={() => setLogging(null)} />}

      {manageGroups && (
        <ManageGroupsModal
          onClose={() => {
            setManageGroups(false);
            void loadGroups();
            void load();
          }}
        />
      )}

      {importResult && (
        <ImportPreviewModal
          preview={importResult}
          onClose={() => setImportResult(null)}
          onCommitted={(r) => {
            setImportResult(null);
            void loadGroups();
            void load();
            toast.success(`Imported: ${r.created} created, ${r.updated} updated, ${r.skipped} skipped.`);
          }}
        />
      )}
    </div>
  );
}

function Dropdown({
  label,
  icon,
  items,
  onPick,
}: {
  label: string;
  icon: React.ReactNode;
  items: [string, string][];
  onPick: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)}>
        {icon} {label}
      </Button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-border bg-surface p-1 shadow-card" onMouseLeave={() => setOpen(false)}>
          {items.map(([value, text]) => (
            <button
              key={value}
              className="w-full rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                onPick(value);
              }}
            >
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ManageGroupsModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<ProductGroupDto[]>([]);
  const [newName, setNewName] = useState('');

  const load = async () => setGroups(await unwrap<ProductGroupDto[]>(window.api.products.groupList()));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      await unwrap(window.api.products.groupCreate(newName.trim()));
      setNewName('');
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not create group');
    }
  };

  const archive = async (g: ProductGroupDto) => {
    await unwrap(window.api.products.groupArchive(g.id));
    void load();
  };

  return (
    <Modal open onClose={onClose} title="Manage Product Groups" width="max-w-md" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="mb-4 flex gap-2">
        <Input placeholder="New group name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        <Button onClick={() => void create()}>
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No groups yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {groups.map((g) => (
            <li key={g.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{g.name}</span>
              <Button variant="ghost" size="sm" onClick={() => void archive(g)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ImportPreviewModal({
  preview,
  onClose,
  onCommitted,
}: {
  preview: ProductImportPreviewDto;
  onClose: () => void;
  onCommitted: (r: ProductImportResultDto) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    setBusy(true);
    try {
      const r = await unwrap<ProductImportResultDto>(window.api.products.importCommit(preview.token));
      onCommitted(r);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-2xl"
      title="Import Preview"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void commit()} disabled={busy || preview.valid_count === 0}>
            {busy ? 'Importing…' : `Import ${preview.valid_count} item(s)`}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-3">
        <Badge tone="success">{preview.valid_count} valid</Badge>
        {preview.duplicate_count > 0 && <Badge tone="warning">{preview.duplicate_count} duplicate</Badge>}
        {preview.error_count > 0 && <Badge tone="danger">{preview.error_count} with errors</Badge>}
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2">Row</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.rows.map((r) => (
              <tr key={r.row_number}>
                <td className="px-3 py-2 text-muted-foreground">{r.row_number}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">
                  {!r.valid ? (
                    <span className="text-danger">{r.errors[0]}</span>
                  ) : r.duplicate_of_name ? (
                    <span className="text-warning">Duplicate of {r.duplicate_of_name} (skip)</span>
                  ) : (
                    <span className="text-success">New</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
