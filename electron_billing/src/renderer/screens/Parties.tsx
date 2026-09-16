import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Plus, Users, Search, Pencil, Archive, Upload, Download, FileSpreadsheet } from 'lucide-react';
import type {
  PartyDto,
  PartyListRequest,
  ImportPreviewDto,
  ImportResultDto,
  ImportAsDto,
} from '@shared/partyDto';
import { PartyType, PARTY_TYPE_LABEL } from '@shared/domain/party';
import { unwrap, ApiError } from '../lib/api';
import { Button, Card, Input, Select, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useColumnPrefs, type ColumnDef } from '../lib/useColumnPrefs';
import { ColumnChooser } from '../components/ColumnChooser';
import { PartyEditor, emptyParty } from './PartyEditor';

type RoleFilter = 'ALL' | 'CUSTOMER' | 'VENDOR';

/** Column catalogue for the party table (Name + Actions are locked). */
const PARTY_COLUMNS: ColumnDef[] = [
  { key: 'name', label: 'Name', locked: true },
  { key: 'contact_person', label: 'Contact Person' },
  { key: 'contact_no', label: 'Contact No' },
  { key: 'gstin', label: 'GSTIN' },
  { key: 'state', label: 'State' },
  { key: 'city', label: 'City' },
  { key: 'company_type', label: 'Company Type' },
  { key: 'balance', label: 'Balance' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions', locked: true },
];

function partyCell(p: PartyDto, key: string, onEdit: () => void, onArchive: () => void): ReactNode {
  switch (key) {
    case 'name':
      return <span className="font-medium">{p.company_name}</span>;
    case 'contact_person':
      return <span className="text-muted-foreground">{p.contact_person || '—'}</span>;
    case 'contact_no':
      return <span className="text-muted-foreground">{p.contact_no || '—'}</span>;
    case 'gstin':
      return <span className="font-mono text-xs">{p.gstin || '—'}</span>;
    case 'state':
      return <span className="text-muted-foreground">{p.billing_address.state || '—'}</span>;
    case 'city':
      return <span className="text-muted-foreground">{p.billing_address.city || '—'}</span>;
    case 'company_type':
      return (
        <Badge tone={p.company_type === PartyType.CUSTOMER_VENDOR ? 'accent' : 'neutral'}>
          {PARTY_TYPE_LABEL[p.company_type]}
        </Badge>
      );
    case 'balance':
      return <span className="text-xs tabular-nums">{p.balance_summary || '—'}</span>;
    case 'status':
      return p.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Archived</Badge>;
    case 'actions':
      return (
        <div className="flex items-center justify-end gap-1">
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

export function Parties() {
  const toast = useToast();
  const [rows, setRows] = useState<PartyDto[]>([]);
  const [role, setRole] = useState<RoleFilter>('ALL');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<PartyDto | null>(null);
  const [importResult, setImportResult] = useState<{ preview: ImportPreviewDto; importAs: ImportAsDto } | null>(null);
  const [loading, setLoading] = useState(true);
  const columns = useColumnPrefs('parties', PARTY_COLUMNS);

  const load = async () => {
    const req: PartyListRequest = {
      role: role === 'ALL' ? 'ALL' : (role as PartyType),
      includeArchived: showArchived,
      search: query.trim() || undefined,
    };
    setRows(await unwrap<PartyDto[]>(window.api.parties.list(req)));
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, showArchived, query]);

  const archive = async (p: PartyDto) => {
    if (!window.confirm(`Archive '${p.company_name}'? It stays for historical records but is hidden from new documents.`))
      return;
    await unwrap(window.api.parties.archive(p.id));
    toast.info(`Archived ${p.company_name}`);
    void load();
  };

  const doExport = async (scope: 'CUSTOMERS' | 'VENDORS' | 'BOTH') => {
    try {
      const path = await unwrap<string>(
        window.api.parties.export({ scope, includeArchived: showArchived }),
      );
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const startImport = async (importAs: ImportAsDto) => {
    try {
      const preview = await unwrap<ImportPreviewDto>(window.api.parties.importPreview({ importAs }));
      if (preview.header_errors.length) {
        toast.error(preview.header_errors[0]);
        return;
      }
      setImportResult({ preview, importAs });
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Could not read file');
    }
  };

  return (
    <div>
      <PageHeader
        title="Customer / Vendor Master"
        description="One record per business — customer, vendor, or both."
        actions={
          <div className="flex items-center gap-2">
            <ColumnChooser prefs={columns} />
            <ImportMenu onPick={startImport} />
            <ExportMenu onPick={doExport} />
            <Button onClick={() => setEditing(emptyParty())}>
              <Plus className="h-4 w-4" /> Add Customer / Vendor
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-3">
        <Select className="w-40" value={role} onChange={(e) => setRole(e.target.value as RoleFilter)}>
          <option value="ALL">All</option>
          <option value="CUSTOMER">Customers</option>
          <option value="VENDOR">Vendors</option>
        </Select>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search name, contact person, phone, or GSTIN"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-4 w-4 accent-accent"
          />
          Show archived
        </label>
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Users className="h-8 w-8" />}
          title={query ? 'No matches' : 'No customers or vendors yet'}
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
                <tr
                  key={p.id}
                  className="cursor-pointer transition-colors hover:bg-muted/40"
                  onDoubleClick={() => setEditing(p)}
                >
                  {columns.visible.map((c) => (
                    <td key={c.key} className={`px-4 py-3 ${c.key === 'actions' ? 'text-right' : ''}`}>
                      {partyCell(p, c.key, () => setEditing(p), () => void archive(p))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            {rows.length} record(s).
          </div>
        </Card>
      )}

      {editing && (
        <PartyEditor
          party={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
            toast.success('Customer / Vendor saved');
          }}
        />
      )}

      {importResult && (
        <ImportPreviewModal
          preview={importResult.preview}
          onClose={() => setImportResult(null)}
          onCommitted={(result) => {
            setImportResult(null);
            void load();
            toast.success(
              `Imported: ${result.created} created, ${result.updated} updated, ${result.skipped} skipped.`,
            );
          }}
        />
      )}
    </div>
  );
}

function ImportMenu({ onPick }: { onPick: (as: ImportAsDto) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)}>
        <Upload className="h-4 w-4" /> Import Excel
      </Button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-52 rounded-md border border-border bg-surface p-1 shadow-card"
          onMouseLeave={() => setOpen(false)}
        >
          {(
            [
              ['FILE', 'Use file’s Company Type'],
              ['CUSTOMER', 'Import all as Customers'],
              ['VENDOR', 'Import all as Vendors'],
              ['CUSTOMER_VENDOR', 'Import all as Customer / Vendor'],
            ] as [ImportAsDto, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                onPick(value);
              }}
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-muted-foreground" />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ExportMenu({ onPick }: { onPick: (scope: 'CUSTOMERS' | 'VENDORS' | 'BOTH') => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((o) => !o)}>
        <Download className="h-4 w-4" /> Export Excel
      </Button>
      {open && (
        <div
          className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-border bg-surface p-1 shadow-card"
          onMouseLeave={() => setOpen(false)}
        >
          {(
            [
              ['BOTH', 'All records'],
              ['CUSTOMERS', 'Customers only'],
              ['VENDORS', 'Vendors only'],
            ] as ['CUSTOMERS' | 'VENDORS' | 'BOTH', string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className="w-full rounded px-2.5 py-2 text-left text-sm hover:bg-muted"
              onClick={() => {
                setOpen(false);
                onPick(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportPreviewModal({
  preview,
  onClose,
  onCommitted,
}: {
  preview: ImportPreviewDto;
  onClose: () => void;
  onCommitted: (result: ImportResultDto) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const commit = async () => {
    setBusy(true);
    try {
      const result = await unwrap<ImportResultDto>(window.api.parties.importCommit(preview.token));
      onCommitted(result);
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void commit()} disabled={busy || preview.valid_count === 0}>
            {busy ? 'Importing…' : `Import ${preview.valid_count} record(s)`}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-3 text-sm">
        <Badge tone="success">{preview.valid_count} valid</Badge>
        {preview.duplicate_count > 0 && <Badge tone="warning">{preview.duplicate_count} duplicate</Badge>}
        {preview.error_count > 0 && <Badge tone="danger">{preview.error_count} with errors</Badge>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Duplicates (matched by GSTIN or name + phone) are skipped by default. Rows with errors are
        not imported.
      </p>
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
                <td className="px-3 py-2">{r.company_name}</td>
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
