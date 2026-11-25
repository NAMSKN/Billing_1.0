import React from 'react';
import { Printer, X } from 'lucide-react';
import { Button } from '../components/ui';
import { rupees } from '../lib/format';

export interface ThermalReceiptData {
  companyName: string;
  companyAddress?: string;
  companyGstin?: string;
  companyPhone?: string;
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  lines: Array<{
    name: string;
    quantity: number;
    unit?: string;
    rate: number;
    amount: number;
  }>;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  roundOff: number;
  total: number;
  upiQrUrl?: string; // QR code data URL for direct scan-to-pay
  terms?: string;
}

interface ThermalReceiptModalProps {
  data: ThermalReceiptData;
  onClose: () => void;
}

export const ThermalReceiptModal: React.FC<ThermalReceiptModalProps> = ({ data, onClose }) => {
  const [paperWidth, setPaperWidth] = React.useState<'58mm' | '80mm'>('80mm');

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/40">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-accent" />
            <h3 className="font-semibold text-foreground text-sm">Thermal POS Receipt Preview</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md shadow-sm">
              <button
                onClick={() => setPaperWidth('58mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-l-md border ${
                  paperWidth === '58mm'
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-muted-foreground border-border'
                }`}
              >
                2" (58mm)
              </button>
              <button
                onClick={() => setPaperWidth('80mm')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-r-md border ${
                  paperWidth === '80mm'
                    ? 'bg-accent text-accent-foreground border-accent'
                    : 'bg-surface text-muted-foreground border-border'
                }`}
              >
                3" (80mm)
              </button>
            </div>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground ml-2">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Receipt Preview (Printable Target) */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-900/40 flex justify-center">
          <div
            id="thermal-printable-area"
            className={`bg-white text-black font-mono shadow-md p-4 text-[11px] leading-tight space-y-3 ${
              paperWidth === '58mm' ? 'w-[230px]' : 'w-[310px]'
            }`}
            style={{ fontFamily: 'Courier New, Courier, monospace' }}
          >
            {/* Business Header */}
            <div className="text-center space-y-0.5">
              <div className="font-bold text-[13px] uppercase">{data.companyName}</div>
              {data.companyAddress && <div className="text-[10px]">{data.companyAddress}</div>}
              {data.companyGstin && <div className="text-[10px]">GSTIN: {data.companyGstin}</div>}
              {data.companyPhone && <div className="text-[10px]">Ph: {data.companyPhone}</div>}
            </div>

            <div className="border-t border-dashed border-black/60 pt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Bill: {data.invoiceNumber}</span>
                <span>{data.invoiceDate}</span>
              </div>
              <div>Customer: {data.customerName}</div>
            </div>

            {/* Line Items Table */}
            <div className="border-t border-dashed border-black/60 pt-2">
              <div className="flex justify-between font-bold border-b border-black pb-1 mb-1">
                <span>Item</span>
                <span className="text-right">Qty × Rate</span>
                <span className="text-right">Amt</span>
              </div>
              <div className="space-y-1">
                {data.lines.map((l, i) => (
                  <div key={i}>
                    <div className="font-bold truncate">{l.name}</div>
                    <div className="flex justify-between text-[10px] text-gray-700">
                      <span>
                        {l.quantity} {l.unit || 'PCS'} × {rupees(l.rate)}
                      </span>
                      <span className="font-bold text-black">{rupees(l.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Taxes & Totals */}
            <div className="border-t border-dashed border-black/60 pt-2 space-y-0.5">
              <div className="flex justify-between">
                <span>Taxable Subtotal:</span>
                <span>{rupees(data.subtotal)}</span>
              </div>
              {data.cgst > 0 && (
                <div className="flex justify-between">
                  <span>CGST:</span>
                  <span>+{rupees(data.cgst)}</span>
                </div>
              )}
              {data.sgst > 0 && (
                <div className="flex justify-between">
                  <span>SGST:</span>
                  <span>+{rupees(data.sgst)}</span>
                </div>
              )}
              {data.igst > 0 && (
                <div className="flex justify-between">
                  <span>IGST:</span>
                  <span>+{rupees(data.igst)}</span>
                </div>
              )}
              {data.roundOff !== 0 && (
                <div className="flex justify-between">
                  <span>Round Off:</span>
                  <span>{rupees(data.roundOff)}</span>
                </div>
              )}
              <div className="border-t border-black pt-1.5 flex justify-between font-bold text-[13px]">
                <span>GRAND TOTAL:</span>
                <span>{rupees(data.total)}</span>
              </div>
            </div>

            {/* UPI QR Code */}
            {data.upiQrUrl && (
              <div className="border-t border-dashed border-black/60 pt-2 flex flex-col items-center gap-1">
                <div className="text-[10px] font-bold">SCAN TO PAY VIA UPI</div>
                <img src={data.upiQrUrl} alt="UPI QR" className="h-28 w-28 border border-black p-1" />
              </div>
            )}

            {/* Footer Greeting */}
            <div className="border-t border-dashed border-black/60 pt-2 text-center text-[10px] space-y-1">
              <div>Thank You! Visit Again.</div>
              {data.terms && <div className="text-[9px] text-gray-600">{data.terms}</div>}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-muted/40">
          <span className="text-xs text-muted-foreground">
            Print directly to connected ESC/POS thermal printer
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={handlePrint} className="flex items-center gap-1.5">
              <Printer className="h-4 w-4" /> Print Receipt
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
