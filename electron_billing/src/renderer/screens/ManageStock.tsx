import { useEffect, useMemo, useState } from 'react';
import { Boxes, Search, Save, Upload, Download, RotateCcw } from 'lucide-react';
import type {
  StockRowDto,
  StockImportPreviewDto,
  StockImportResultDto,
} from '@shared/stockDto';
import { unwrap, ApiError } from '../lib/api';
import { Button, Card, Input, EmptyState, Badge } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

/**
 * Manage Stock — set an absolute final stock per product (the app computes the
 * delta and posts one adjustment). Change/Final inputs stay in sync; Save posts
 * all edits atomically. Bulk Edit Stock drives the Excel export/import.
 */

interface RowEdit {
  final: string; // what the user wants current stock to become
  remarks: string;
}

export function ManageStock() {
  const toast = useToast();
  const [rows, setRows] = useState<StockRowDto[]>([]);
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [importResult, setImportResult] = useState<StockImportPreviewDto | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setRows(await unwrap<StockRowDto[]>(window.api.stock.list()));
    setEdits({});
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const n = query.trim().toLowerCase();
    return n ? rows.filter((r) => r.name.toLowerCase().includes(n)) : rows;
  }, [rows, query]);

  const setFinal = (row: StockRowDto, value: string) =>
    setEdits((e) => ({ ...e, [row.product_id]: { final: value, remarks: e[row.product_id]?.remarks ?? '' } }));
  const setChange = (row: StockRowDto, value: string) => {
    // Change input: final = current + change.
    const change = Number(value || '0');
    const final = Number.isFinite(change) ? (Number(row.current) + change).toString() : '';
    setEdits((e) => ({ ...e, [row.product_id]: { final, remarks: e[row.product_id]?.remarks ?? '' } }));
  };
  const setRemarks = (row: StockRowDto, value: string) =>
    setEdits((e) => ({ ...e, [row.product_id]: { final: e[row.product_id]?.final ?? '', remarks: value } }));

  const dirtyEntries = useMemo(
    () =>
      Object.entries(edits)
        .filter(([id, e]) => {
          const row = rows.find((r) => r.product_id === id);
          return row && e.final !== '' && e.final !== row.current;
        })
        .map(([id, e]) => ({ product_id: id, final_qty: e.final, remarks: e.remarks })),
    [edits, rows],
  );

  const save = async () => {
    if (dirtyEntries.length === 0) {
      toast.info('No stock changes to save');
      return;
    }
    setSaving(true);
    try {
      const r = await unwrap<{ adjusted: number; unchanged: number }>(
        window.api.stock.adjustMany({ entries: dirtyEntries }),
      );
      toast.success(`Updated stock for ${r.adjusted} product(s)`);
      void load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save stock');
    } finally {
      setSaving(false);
    }
  };

  const bulkExport = async () => {
    try {
      const path = await unwrap<string>(window.api.stock.bulkExport());
      toast.success(`Exported to ${path}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.includes('cancelled')) return;
      toast.error(err instanceof ApiError ? err.message : 'Export failed');
    }
  };

  const bulkImport = async () => {
    try {
      const preview = await unwrap<StockImportPreviewDto>(window.api.stock.bulkImportPreview());
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
        title="Manage Stock"
        description="Set the current stock for each product. Changes are recorded as adjustments."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void bulkExport()}>
              <Download className="h-4 w-4" /> Export Stock
            </Button>
            <Button variant="outline" onClick={() => void bulkImport()}>
              <Upload className="h-4 w-4" /> Bulk Edit Stock
            </Button>
            <Button onClick={() => void save()} disabled={saving || dirtyEntries.length === 0}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : `Save${dirtyEntries.length ? ` (${dirtyEntries.length})` : ''}`}
            </Button>
          </div>
        }
      />

      <div className="mb-4 relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search products…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="No stock-tracking products"
          description="Add products with a unit of measurement in Products / Services to manage their stock."
        />
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Group</th>
                <th className="px-4 py-3 text-right font-medium">Current Stock</th>
                <th className="px-4 py-3 font-medium">Change</th>
                <th className="px-4 py-3 font-medium">Final Stock</th>
                <th className="px-4 py-3 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((row) => {
                const edit = edits[row.product_id];
                const final = edit?.final ?? '';
                const change = final === '' ? '' : (Number(final) - Number(row.current)).toString();
                return (
                  <tr key={row.product_id} className="transition-colors hover:bg-muted/30">
                    <td className="px-4 py-2.5 font-medium">
                      {row.name}
                      {row.is_low && (
                        <span className="ml-2">
                          <Badge tone="warning">Low</Badge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.group_name || '—'}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.current} <span className="text-xs text-muted-foreground">{row.unit}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <Input
                        className="h-8 w-28"
                        value={change}
                        onChange={(e) => setChange(row, e.target.value)}
                        placeholder="±0"
                        inputMode="decimal"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Input
                        className="h-8 w-28"
                        value={final}
                        onChange={(e) => setFinal(row, e.target.value)}
                        placeholder={row.current}
                        inputMode="decimal"
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <Input
                        className="h-8"
                        value={edit?.remarks ?? ''}
                        onChange={(e) => setRemarks(row, e.target.value)}
                        placeholder="Optional"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {importResult && (
        <BulkImportModal
          preview={importResult}
          onClose={() => setImportResult(null)}
          onCommitted={(r) => {
            setImportResult(null);
            void load();
            toast.success(`Stock updated: ${r.adjusted} adjusted, ${r.unchanged} unchanged, ${r.skipped} skipped.`);
          }}
        />
      )}
    </div>
  );
}

function BulkImportModal({
  preview,
  onClose,
  onCommitted,
}: {
  preview: StockImportPreviewDto;
  onClose: () => void;
  onCommitted: (r: StockImportResultDto) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const commit = async () => {
    setBusy(true);
    try {
      const r = await unwrap<StockImportResultDto>(window.api.stock.bulkImportCommit(preview.token));
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
      title="Bulk Stock Update Preview"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void commit()} disabled={busy || preview.adjust_count === 0}>
            {busy ? 'Applying…' : `Apply ${preview.adjust_count} change(s)`}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-3">
        <Badge tone="success">{preview.adjust_count} to adjust</Badge>
        {preview.unchanged_count > 0 && <Badge tone="neutral">{preview.unchanged_count} unchanged</Badge>}
        {preview.error_count > 0 && <Badge tone="danger">{preview.error_count} with errors</Badge>}
      </div>
      <div className="max-h-80 overflow-y-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted">
            <tr className="text-left text-muted-foreground">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Current</th>
              <th className="px-3 py-2 text-right">Target</th>
              <th className="px-3 py-2 text-right">Change</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {preview.rows.map((r) => (
              <tr key={r.row_number}>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.current}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.target ?? '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.delta ?? '—'}</td>
                <td className="px-3 py-2">
                  {r.error ? (
                    <span className="text-danger">{r.error}</span>
                  ) : r.delta === '0' ? (
                    <span className="text-muted-foreground">Unchanged</span>
                  ) : (
                    <span className="text-success">Will adjust</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <RotateCcw className="h-3 w-3" /> The "Updated Stock" column is the target current stock; the change is computed automatically.
      </p>
    </Modal>
  );
}
