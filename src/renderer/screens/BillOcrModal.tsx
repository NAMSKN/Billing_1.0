import React, { useState, useRef } from 'react';
import { Upload, Wand2, X, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { Button, Input } from '../components/ui';
import { rupees } from '../lib/format';
import {
  heuristicParseBill,
  ParsedBill,
  CatalogProduct,
} from '../../shared/domain/purchaseOcr';

interface BillOcrModalProps {
  onClose: () => void;
  onApply: (parsed: ParsedBill) => void;
  catalog: CatalogProduct[];
}

export const BillOcrModal: React.FC<BillOcrModalProps> = ({ onClose, onApply, catalog }) => {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'ocr' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [parsed, setParsed] = useState<ParsedBill | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      alert('Please upload an image (PNG, JPG, WebP).');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setStatus('idle');
    setParsed(null);
    setProgress(0);
  };

  const runOcr = async () => {
    if (!file) return;
    setStatus('ocr');
    setProgress(10);
    setErrorMsg('');

    try {
      const Tesseract = await import('tesseract.js');
      // Use locally bundled Tesseract files under public/tesseract/ for strict offline execution
      const worker = await Tesseract.createWorker('eng', 1, {
        workerPath: '/tesseract/worker.min.js',
        corePath: '/tesseract/core',
        langPath: '/tesseract/lang',
        gzip: false,
        logger: (m) => {
          if (typeof m?.progress === 'number') {
            setProgress(Math.round(m.progress * 100));
          }
        },
      });

      const { data } = await worker.recognize(file);
      await worker.terminate();

      const result = heuristicParseBill(data.text, catalog);
      setParsed(result);
      setStatus('done');
    } catch (err: any) {
      console.error('OCR Error:', err);
      setErrorMsg(err?.message || 'Failed to process document with OCR');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground text-base">Inward Purchase Bill OCR</h3>
              <p className="text-xs text-muted-foreground">
                Offline AI text recognition directly from vendor invoice scan/photo
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {!file && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border hover:border-accent rounded-xl p-12 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3 bg-muted/10 hover:bg-muted/20"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                <Upload className="h-6 w-6" />
              </div>
              <div className="font-medium text-foreground">Click to upload supplier tax invoice image</div>
              <p className="text-xs text-muted-foreground max-w-sm">
                Supports JPG, PNG, WebP. Optical recognition runs 100% offline with zero cloud latency.
              </p>
            </div>
          )}

          {file && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Image Preview */}
              <div className="space-y-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex justify-between">
                  <span>Uploaded Invoice</span>
                  <button
                    onClick={() => {
                      setFile(null);
                      setParsed(null);
                      setStatus('idle');
                    }}
                    className="text-xs text-danger hover:underline"
                  >
                    Change Image
                  </button>
                </div>
                <div className="border border-border rounded-lg overflow-hidden bg-black/20 max-h-96 flex items-center justify-center">
                  <img src={previewUrl} alt="Bill Preview" className="object-contain max-h-96 w-full" />
                </div>
                {status === 'idle' && (
                  <Button onClick={runOcr} className="w-full flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4" /> Start OCR Scanning
                  </Button>
                )}
                {status === 'ocr' && (
                  <div className="p-4 rounded-lg border border-border bg-muted/30 space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="flex items-center gap-1.5 text-accent">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Recognizing text...
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="w-full bg-border h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-accent h-full transition-all duration-300"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                )}
                {status === 'error' && (
                  <div className="p-3 bg-danger/10 border border-danger text-danger text-xs rounded-lg flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{errorMsg}</span>
                  </div>
                )}
              </div>

              {/* Parsed Results */}
              <div className="space-y-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Extracted Bill Details
                </div>

                {status !== 'done' || !parsed ? (
                  <div className="h-64 border border-border rounded-lg flex flex-col items-center justify-center text-muted-foreground text-xs p-6 text-center">
                    <Wand2 className="h-8 w-8 mb-2 opacity-40" />
                    <span>Run OCR scan on the invoice image to extract supplier, bill number, date and items.</span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Supplier Name</label>
                        <Input
                          value={parsed.supplierName}
                          onChange={(e) => setParsed({ ...parsed, supplierName: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Supplier GSTIN</label>
                        <Input
                          value={parsed.supplierGstin}
                          onChange={(e) => setParsed({ ...parsed, supplierGstin: e.target.value })}
                          className="font-mono uppercase"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Bill / Invoice No.</label>
                        <Input
                          value={parsed.invoiceNumber}
                          onChange={(e) => setParsed({ ...parsed, invoiceNumber: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Bill Date</label>
                        <Input
                          type="date"
                          value={parsed.date}
                          onChange={(e) => setParsed({ ...parsed, date: e.target.value })}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Grand Total (₹)</label>
                        <Input
                          type="number"
                          value={parsed.grandTotal || ''}
                          onChange={(e) => setParsed({ ...parsed, grandTotal: Number(e.target.value) })}
                          className="font-bold text-accent"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-muted-foreground">Taxable Value (₹)</label>
                        <Input
                          type="number"
                          value={parsed.taxBreakdown.taxableValue || ''}
                          onChange={(e) =>
                            setParsed({
                              ...parsed,
                              taxBreakdown: { ...parsed.taxBreakdown, taxableValue: Number(e.target.value) },
                            })
                          }
                        />
                      </div>
                    </div>

                    {/* Extracted items */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-[11px] font-semibold text-muted-foreground uppercase">
                          Detected Line Items ({parsed.items.length})
                        </label>
                      </div>
                      <div className="border border-border rounded-lg max-h-48 overflow-y-auto divide-y divide-border text-xs">
                        {parsed.items.length === 0 ? (
                          <div className="p-3 text-center text-muted-foreground">No line items automatically detected</div>
                        ) : (
                          parsed.items.map((it, idx) => (
                            <div key={idx} className="p-2.5 flex items-center justify-between gap-2">
                              <div className="flex-1 truncate">
                                <div className="font-medium text-foreground truncate">{it.name}</div>
                                <div className="text-[10px] text-muted-foreground flex gap-2">
                                  <span>HSN: {it.hsn || '—'}</span>
                                  <span>Qty: {it.quantity}</span>
                                  <span>Rate: {rupees(it.rate)}</span>
                                  {it.matchedName && (
                                    <span className="text-accent">Auto-matched: {it.matchedName}</span>
                                  )}
                                </div>
                              </div>
                              <div className="font-bold font-mono text-foreground">{rupees(it.amount)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border bg-muted/40">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!parsed || status !== 'done'}
            onClick={() => {
              if (parsed) {
                onApply(parsed);
                onClose();
              }
            }}
          >
            Apply to Purchase Bill
          </Button>
        </div>
      </div>
    </div>
  );
};
