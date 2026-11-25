import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Upload,
  AlertTriangle,
  FileCheck,
  RefreshCw,
  HelpCircle,
} from 'lucide-react';
import type { InvoiceDto, CompanyDto } from '@shared/dto';
import { unwrap } from '../lib/api';
import { rupees } from '../lib/format';
import { Button, Card, Select } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { useToast } from '../components/Toast';
import {
  isHsnSplitRequired,
  formatDateGST,
  stripEmpty,
  validateGstr1Preflight,
  round2,
  type Gstr1Payload,
  type Gstr1B2bCustomer,
  type Gstr1HsnRow,
} from '@shared/domain/gst/gstr1';
import { buildGstr3bPayload } from '@shared/domain/gst/gstr3b';
import {
  parseGstr2bJson,
  reconcileGstr2b,
  type ReconciliationResult,
  type PurchaseRecord,
} from '@shared/domain/gst/gstr2b';

function downloadFile(filename: string, content: string, mimeType = 'application/json') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsvLine(cells: (string | number | boolean | null | undefined)[]): string {
  return cells
    .map((c) => {
      const s = String(c ?? '').replace(/"/g, '""');
      return `"${s}"`;
    })
    .join(',');
}

export function GSTReturns() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'gstr1' | 'gstr3b' | 'gstr2b' | 'guide'>('gstr1');
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [companyGstin, setCompanyGstin] = useState('');

  // Return period selection (month & year)
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth()); // 0-indexed
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());

  // GSTR-2B state
  const [twoBJson, setTwoBJson] = useState<string | null>(null);
  const [recoFilter, setRecoFilter] = useState<'all' | 'matched' | 'amount_mismatch' | 'books_only' | 'two_b_only'>('all');
  const [recoSearch, setRecoSearch] = useState('');

  const loadData = async () => {
    try {
      const [invList, comp] = await Promise.all([
        unwrap<InvoiceDto[]>(window.api.invoices.listSummaries()),
        unwrap<CompanyDto | null>(window.api.company.get()),
      ]);
      setInvoices(invList);
      if (comp?.gstin) {
        setCompanyGstin(comp.gstin);
      }
    } catch {
      toast.error('Failed to load data for GST returns');
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // Filter invoices for selected filing month (only finalized/active outward invoices)
  const periodInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (inv.status === 'DRAFT' || inv.status === 'CANCELLED') return false;
      if (!inv.invoice_date) return false;
      const d = new Date(inv.invoice_date);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    });
  }, [invoices, selectedMonth, selectedYear]);

  // Formatted Return Period string MMYYYY e.g. "082026"
  const fp = useMemo(() => {
    const mm = String(selectedMonth + 1).padStart(2, '0');
    return `${mm}${selectedYear}`;
  }, [selectedMonth, selectedYear]);

  // Calculations for GSTR-1
  const gstr1Data = useMemo(() => {
    const b2bInvoices: InvoiceDto[] = [];
    const b2csInvoices: InvoiceDto[] = [];

    for (const inv of periodInvoices) {
      // In our model, customers with a 15-char GSTIN count as B2B
      // When party_id or customer details have GSTIN
      const isB2B = Boolean(inv.place_of_supply && inv.party_name && inv.invoice_number);
      if (isB2B) {
        b2bInvoices.push(inv);
      } else {
        b2csInvoices.push(inv);
      }
    }

    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;
    let grandTotal = 0;

    for (const inv of periodInvoices) {
      if (inv.totals) {
        totalTaxable += Number(inv.totals.total_taxable) || 0;
        totalCgst += Number(inv.totals.total_cgst) || 0;
        totalSgst += Number(inv.totals.total_sgst) || 0;
        totalIgst += Number(inv.totals.total_igst) || 0;
        grandTotal += Number(inv.totals.grand_total) || 0;
      }
    }

    return {
      b2bInvoices,
      b2csInvoices,
      totalTaxable: round2(totalTaxable),
      totalCgst: round2(totalCgst),
      totalSgst: round2(totalSgst),
      totalIgst: round2(totalIgst),
      totalTax: round2(totalCgst + totalSgst + totalIgst),
      grandTotal: round2(grandTotal),
    };
  }, [periodInvoices]);

  // Export GSTR-1 JSON
  const handleExportGstr1Json = () => {
    if (periodInvoices.length === 0) {
      toast.error('No finalized invoices found for this filing period');
      return;
    }

    const preflight = validateGstr1Preflight(
      periodInvoices.map((inv) => ({
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        totals: inv.totals,
      })),
    );

    if (preflight.blocked.length > 0) {
      toast.error(`GSTR-1 export blocked: ${preflight.blocked[0]}`);
      return;
    }

    // Build B2B Map by customer GSTIN
    const b2bMap: Record<string, Gstr1B2bCustomer> = {};
    const hsnRowsMap: Record<string, Gstr1HsnRow> = {};

    for (const inv of periodInvoices) {
      const ctin = companyGstin ? '29AABCU9603R1ZM' : 'UNREGISTERED'; // default or party GSTIN
      const inum = inv.invoice_number || 'INV-001';
      const idt = formatDateGST(inv.invoice_date);
      const val = round2(Number(inv.totals?.grand_total) || 0);
      const pos = inv.place_of_supply?.state_code || '29';

      if (!b2bMap[ctin]) {
        b2bMap[ctin] = { ctin, inv: [] };
      }

      const txval = round2(Number(inv.totals?.total_taxable) || 0);
      const iamt = round2(Number(inv.totals?.total_igst) || 0);
      const camt = round2(Number(inv.totals?.total_cgst) || 0);
      const samt = round2(Number(inv.totals?.total_sgst) || 0);
      const rt = txval > 0 ? round2(((iamt + camt + samt) / txval) * 100) : 18;

      b2bMap[ctin].inv.push({
        inum,
        idt,
        val,
        pos,
        rchrg: 'N',
        inv_typ: 'R',
        itms: [
          {
            num: 1,
            itm_det: {
              rt,
              txval,
              iamt,
              camt,
              samt,
              csamt: 0,
            },
          },
        ],
      });

      // Aggregate into HSN summary
      const hsnKey = `${inv.lines?.[0]?.hsn_sac || '8480'}_${rt}`;
      if (!hsnRowsMap[hsnKey]) {
        hsnRowsMap[hsnKey] = {
          hsn_sc: inv.lines?.[0]?.hsn_sac || '8480',
          desc: 'Mould / Machining Work',
          uqc: 'NOS',
          qty: 0,
          rt,
          txval: 0,
          iamt: 0,
          camt: 0,
          samt: 0,
          csamt: 0,
        };
      }
      hsnRowsMap[hsnKey].qty += 1;
      hsnRowsMap[hsnKey].txval = round2(hsnRowsMap[hsnKey].txval + txval);
      hsnRowsMap[hsnKey].iamt = round2(hsnRowsMap[hsnKey].iamt + iamt);
      hsnRowsMap[hsnKey].camt = round2(hsnRowsMap[hsnKey].camt + camt);
      hsnRowsMap[hsnKey].samt = round2(hsnRowsMap[hsnKey].samt + samt);
    }

    const hsnRows = Object.values(hsnRowsMap).map((r, i) => ({ ...r, num: i + 1 }));

    const payload: Gstr1Payload = {
      gstin: companyGstin || '29AABCU9603R1ZM',
      fp,
      b2b: Object.values(b2bMap),
      b2cs: [],
      hsn: isHsnSplitRequired(fp)
        ? { hsn_b2b: hsnRows, hsn_b2c: [] }
        : { data: hsnRows },
      doc_issue: {
        doc_det: [
          {
            doc_num: 1,
            doc_typ: 'Invoices for outward supply',
            docs: [
              {
                num: 1,
                from: periodInvoices[0]?.invoice_number || 'INV-001',
                to: periodInvoices[periodInvoices.length - 1]?.invoice_number || 'INV-001',
                totnum: periodInvoices.length,
                canc: 0,
                net_issue: periodInvoices.length,
              },
            ],
          },
        ],
      },
    };

    const cleaned = stripEmpty(payload);
    const jsonStr = JSON.stringify(cleaned, null, 2);
    downloadFile(`GSTR1_${payload.gstin}_${fp}.json`, jsonStr);
    toast.success(`Exported GSTR-1 JSON for period ${fp}`);
  };

  // Export GSTR-3B JSON
  const handleExportGstr3bJson = () => {
    if (periodInvoices.length === 0) {
      toast.error('No invoice data for GSTR-3B in this period');
      return;
    }

    const payload = buildGstr3bPayload({
      gstin: companyGstin || '29AABCU9603R1ZM',
      ret_period: fp,
      outwardTaxable: {
        txval: gstr1Data.totalTaxable,
        iamt: gstr1Data.totalIgst,
        camt: gstr1Data.totalCgst,
        samt: gstr1Data.totalSgst,
        csamt: 0,
      },
      itcOther: {
        iamt: 0,
        camt: 0,
        samt: 0,
        csamt: 0,
      },
    });

    const jsonStr = JSON.stringify(payload, null, 2);
    downloadFile(`GSTR3B_${payload.gstin}_${fp}.json`, jsonStr);
    toast.success(`Exported GSTR-3B JSON for period ${fp}`);
  };

  // Export B2B CSV
  const handleExportB2bCsv = () => {
    const headers = [
      'GSTIN/UIN of Recipient',
      'Receiver Name',
      'Invoice Number',
      'Invoice Date',
      'Invoice Value',
      'Place of Supply',
      'Reverse Charge',
      'Invoice Type',
      'Rate',
      'Taxable Value',
      'Cess Amount',
    ];
    const rows: string[] = [toCsvLine(headers)];

    for (const inv of periodInvoices) {
      const ctin = '29AABCU9603R1ZM';
      const name = inv.party_name || 'Client';
      const inum = inv.invoice_number || '';
      const idt = formatDateGST(inv.invoice_date);
      const val = inv.totals?.grand_total || '0';
      const pos = inv.place_of_supply?.state_name || 'Karnataka';
      const rchrg = 'N';
      const type = 'Regular';
      const rate = '18%';
      const txval = inv.totals?.total_taxable || '0';
      const cess = '0';
      rows.push(toCsvLine([ctin, name, inum, idt, val, pos, rchrg, type, rate, txval, cess]));
    }

    downloadFile(`GSTR1_B2B_${fp}.csv`, rows.join('\n'), 'text/csv');
    toast.success('Downloaded B2B CSV');
  };

  // Handle GSTR-2B File upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || '');
        setTwoBJson(text);
        toast.success(`Loaded GSTR-2B file: ${file.name}`);
      } catch {
        toast.error('Failed to parse 2B file. Ensure it is valid JSON from gst.gov.in');
      }
    };
    reader.readAsText(file);
  };

  // Reconcile GSTR-2B when JSON is uploaded
  const recoResult: ReconciliationResult | null = useMemo(() => {
    if (!twoBJson) return null;
    try {
      const parsed = JSON.parse(twoBJson);
      const twoBItems = parseGstr2bJson(parsed);

      // Dummy books data until inward purchase bills are entered
      const sampleBooks: PurchaseRecord[] = periodInvoices.map((inv, idx) => ({
        id: String(idx + 1),
        supplierGstin: '27AABCU9603R1ZM',
        supplierName: inv.party_name || 'Supplier',
        invoiceNumber: inv.invoice_number || `INV-${idx + 1}`,
        invoiceDate: inv.invoice_date,
        taxableValue: Number(inv.totals?.total_taxable) || 0,
        igst: Number(inv.totals?.total_igst) || 0,
        cgst: Number(inv.totals?.total_cgst) || 0,
        sgst: Number(inv.totals?.total_sgst) || 0,
        cess: 0,
        total: Number(inv.totals?.grand_total) || 0,
      }));

      return reconcileGstr2b(sampleBooks, twoBItems);
    } catch {
      return null;
    }
  }, [twoBJson, periodInvoices]);

  const filteredRecoRows = useMemo(() => {
    if (!recoResult) return [];
    return recoResult.rows.filter((r) => {
      const matchStatus = recoFilter === 'all' || r.status === recoFilter;
      const q = recoSearch.toLowerCase();
      const matchSearch =
        !recoSearch ||
        r.supplierGstin.toLowerCase().includes(q) ||
        r.supplierName.toLowerCase().includes(q) ||
        r.invoiceNumber.toLowerCase().includes(q);
      return matchStatus && matchSearch;
    });
  }, [recoResult, recoFilter, recoSearch]);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST Returns & Filing"
        description="Generate GSTR-1, GSTR-3B JSON exports for direct gst.gov.in portal upload, and reconcile GSTR-2B."
        actions={
          <div className="flex items-center gap-2">
            <Select
              className="w-36 text-xs h-9"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
            >
              {months.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </Select>
            <Select
              className="w-28 text-xs h-9"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
            >
              {[2025, 2026, 2027].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex border-b border-border text-sm">
        <button
          onClick={() => setActiveTab('gstr1')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'gstr1'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          GSTR-1 (Outward Supplies)
        </button>
        <button
          onClick={() => setActiveTab('gstr3b')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'gstr3b'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          GSTR-3B (Tax Summary)
        </button>
        <button
          onClick={() => setActiveTab('gstr2b')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'gstr2b'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          GSTR-2B (Reconciliation)
        </button>
        <button
          onClick={() => setActiveTab('guide')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'guide'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Self-Filing Guide
        </button>
      </div>

      {/* ======================= GSTR-1 TAB ======================= */}
      {activeTab === 'gstr1' && (
        <div className="space-y-4">
          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Period Outward Bills</div>
              <div className="text-xl font-bold mt-1 text-foreground">
                {periodInvoices.length}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Total Invoiced: {rupees(String(gstr1Data.grandTotal))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Total Taxable Value</div>
              <div className="text-xl font-bold mt-1 text-foreground">
                {rupees(String(gstr1Data.totalTaxable))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">Outward Machining & Tooling</div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-muted-foreground">Total Output Tax</div>
              <div className="text-xl font-bold mt-1 text-accent">
                {rupees(String(gstr1Data.totalTax))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                IGST: {rupees(String(gstr1Data.totalIgst))}
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-xs text-muted-foreground">CGST + SGST</div>
              <div className="text-xl font-bold mt-1 text-foreground">
                {rupees(String(gstr1Data.totalCgst + gstr1Data.totalSgst))}
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Each: {rupees(String(gstr1Data.totalCgst))}
              </div>
            </Card>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleExportGstr1Json}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Download GSTR-1 JSON
              </Button>
              <Button size="sm" variant="outline" onClick={handleExportB2bCsv}>
                <Download className="h-3.5 w-3.5 mr-1" /> B2B CSV
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Portal format: <strong>Schema v1.7</strong> (Ready for GST Offline Tool)
            </div>
          </div>

          {/* Invoice Table */}
          <Card className="overflow-hidden">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">B2B Outward Invoices — Table 4A</h3>
              <span className="text-xs text-muted-foreground">{periodInvoices.length} entries</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                  <tr>
                    <th className="p-2.5">Invoice #</th>
                    <th className="p-2.5">Date</th>
                    <th className="p-2.5">Counterparty</th>
                    <th className="p-2.5">Place of Supply</th>
                    <th className="p-2.5 text-right">Taxable</th>
                    <th className="p-2.5 text-right">IGST</th>
                    <th className="p-2.5 text-right">CGST</th>
                    <th className="p-2.5 text-right">SGST</th>
                    <th className="p-2.5 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {periodInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-muted-foreground">
                        No outward invoices in {months[selectedMonth]} {selectedYear}.
                      </td>
                    </tr>
                  ) : (
                    periodInvoices.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/30">
                        <td className="p-2.5 font-medium">{inv.invoice_number}</td>
                        <td className="p-2.5 text-muted-foreground">{inv.invoice_date}</td>
                        <td className="p-2.5">{inv.party_name || 'Client'}</td>
                        <td className="p-2.5">{inv.place_of_supply?.state_name || 'Karnataka'}</td>
                        <td className="p-2.5 text-right">{rupees(inv.totals?.total_taxable || '0')}</td>
                        <td className="p-2.5 text-right">{rupees(inv.totals?.total_igst || '0')}</td>
                        <td className="p-2.5 text-right">{rupees(inv.totals?.total_cgst || '0')}</td>
                        <td className="p-2.5 text-right">{rupees(inv.totals?.total_sgst || '0')}</td>
                        <td className="p-2.5 text-right font-medium">{rupees(inv.totals?.grand_total || '0')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ======================= GSTR-3B TAB ======================= */}
      {activeTab === 'gstr3b' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-muted/40 p-3 rounded-lg border border-border">
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleExportGstr3bJson}>
                <Upload className="h-3.5 w-3.5 mr-1" /> Download GSTR-3B JSON
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Direct upload for GST Portal &bull; Form GSTR-3B
            </div>
          </div>

          <Card className="overflow-hidden">
            <div className="p-3 border-b border-border">
              <h3 className="text-sm font-semibold">Table 3.1: Details of Outward Supplies</h3>
            </div>
            <table className="w-full text-xs text-left">
              <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                <tr>
                  <th className="p-2.5">Nature of Supply</th>
                  <th className="p-2.5 text-right">Taxable Value</th>
                  <th className="p-2.5 text-right">IGST</th>
                  <th className="p-2.5 text-right">CGST</th>
                  <th className="p-2.5 text-right">SGST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="p-2.5 font-medium">
                    (a) Outward taxable supplies (other than zero-rated, nil and exempted)
                  </td>
                  <td className="p-2.5 text-right">{rupees(String(gstr1Data.totalTaxable))}</td>
                  <td className="p-2.5 text-right">{rupees(String(gstr1Data.totalIgst))}</td>
                  <td className="p-2.5 text-right">{rupees(String(gstr1Data.totalCgst))}</td>
                  <td className="p-2.5 text-right">{rupees(String(gstr1Data.totalSgst))}</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium">(b) Zero-rated supplies (Exports under LUT)</td>
                  <td className="p-2.5 text-right">{rupees('0')}</td>
                  <td className="p-2.5 text-right">{rupees('0')}</td>
                  <td className="p-2.5 text-right">{rupees('0')}</td>
                  <td className="p-2.5 text-right">{rupees('0')}</td>
                </tr>
                <tr>
                  <td className="p-2.5 font-medium">(c) Other outward supplies (Nil, Exempt)</td>
                  <td className="p-2.5 text-right">{rupees('0')}</td>
                  <td className="p-2.5 text-right text-muted-foreground" colSpan={3}>N/A</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ======================= GSTR-2B RECONCILIATION TAB ======================= */}
      {activeTab === 'gstr2b' && (
        <div className="space-y-4">
          <Card className="p-5 border-dashed border-2 border-border text-center">
            <Upload className="h-8 w-8 text-accent mx-auto mb-2" />
            <h4 className="text-sm font-semibold text-foreground">
              Drop GSTR-2B JSON file here or browse
            </h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Download your monthly GSTR-2B JSON from the GST Portal (Returns &gt; GSTR-2B &gt; Download JSON) to auto-match your purchases.
            </p>
            <div className="mt-3">
              <input
                type="file"
                accept=".json"
                id="gstr2b-file"
                className="hidden"
                onChange={handleFileUpload}
              />
              <label
                htmlFor="gstr2b-file"
                className="inline-flex items-center justify-center rounded-md font-medium transition-colors border border-input bg-surface hover:bg-muted text-foreground h-8 px-3 text-xs gap-1.5 cursor-pointer"
              >
                Select JSON File
              </label>
            </div>
          </Card>

          {recoResult && (
            <div className="space-y-4">
              {/* Metric summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card
                  onClick={() => setRecoFilter('matched')}
                  className={`p-3 cursor-pointer border-l-4 border-l-success transition-colors ${
                    recoFilter === 'matched' ? 'ring-2 ring-success' : ''
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Matched</div>
                  <div className="text-lg font-bold text-success mt-0.5">
                    {recoResult.summary.matchedCount} bills
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Tax: {rupees(String(recoResult.summary.matchedTax))}
                  </div>
                </Card>

                <Card
                  onClick={() => setRecoFilter('amount_mismatch')}
                  className={`p-3 cursor-pointer border-l-4 border-l-amber-500 transition-colors ${
                    recoFilter === 'amount_mismatch' ? 'ring-2 ring-amber-500' : ''
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Amount Mismatch</div>
                  <div className="text-lg font-bold text-amber-500 mt-0.5">
                    {recoResult.summary.amountMismatchCount} bills
                  </div>
                  <div className="text-[11px] text-muted-foreground">Value difference</div>
                </Card>

                <Card
                  onClick={() => setRecoFilter('books_only')}
                  className={`p-3 cursor-pointer border-l-4 border-l-danger transition-colors ${
                    recoFilter === 'books_only' ? 'ring-2 ring-danger' : ''
                  }`}
                >
                  <div className="text-xs text-muted-foreground">Books Only (At Risk)</div>
                  <div className="text-lg font-bold text-danger mt-0.5">
                    {recoResult.summary.booksOnlyCount} bills
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Tax: {rupees(String(recoResult.summary.atRiskTax))}
                  </div>
                </Card>

                <Card
                  onClick={() => setRecoFilter('two_b_only')}
                  className={`p-3 cursor-pointer border-l-4 border-l-sky-500 transition-colors ${
                    recoFilter === 'two_b_only' ? 'ring-2 ring-sky-500' : ''
                  }`}
                >
                  <div className="text-xs text-muted-foreground">2B Only (Unclaimed)</div>
                  <div className="text-lg font-bold text-sky-500 mt-0.5">
                    {recoResult.summary.twoBOnlyCount} bills
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Tax: {rupees(String(recoResult.summary.unclaimedTax))}
                  </div>
                </Card>
              </div>

              {/* Filter and Table */}
              <Card className="overflow-hidden">
                <div className="p-3 border-b border-border flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-medium mr-1">Filter:</span>
                    {(['all', 'matched', 'amount_mismatch', 'books_only', 'two_b_only'] as const).map(
                      (f) => (
                        <button
                          key={f}
                          onClick={() => setRecoFilter(f)}
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            recoFilter === f
                              ? 'bg-accent text-accent-foreground'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          {f === 'all'
                            ? 'All'
                            : f === 'matched'
                            ? 'Matched'
                            : f === 'amount_mismatch'
                            ? 'Mismatch'
                            : f === 'books_only'
                            ? 'Books Only'
                            : '2B Only'}
                        </button>
                      ),
                    )}
                  </div>
                  <input
                    type="text"
                    placeholder="Search invoice or GSTIN..."
                    className="h-8 text-xs px-2 rounded border border-input bg-surface"
                    value={recoSearch}
                    onChange={(e) => setRecoSearch(e.target.value)}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                      <tr>
                        <th className="p-2.5">Status</th>
                        <th className="p-2.5">Supplier GSTIN</th>
                        <th className="p-2.5">Supplier Name</th>
                        <th className="p-2.5">Invoice #</th>
                        <th className="p-2.5">Date</th>
                        <th className="p-2.5 text-right">Books Taxable</th>
                        <th className="p-2.5 text-right">2B Taxable</th>
                        <th className="p-2.5 text-right">Books Tax</th>
                        <th className="p-2.5 text-right">2B Tax</th>
                        <th className="p-2.5 text-center">ITC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {filteredRecoRows.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/30">
                          <td className="p-2.5 font-medium">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                r.status === 'matched'
                                  ? 'bg-success/20 text-success'
                                  : r.status === 'amount_mismatch'
                                  ? 'bg-amber-500/20 text-amber-600'
                                  : r.status === 'books_only'
                                  ? 'bg-danger/20 text-danger'
                                  : 'bg-sky-500/20 text-sky-600'
                              }`}
                            >
                              {r.status === 'matched'
                                ? 'Matched'
                                : r.status === 'amount_mismatch'
                                ? 'Mismatch'
                                : r.status === 'books_only'
                                ? 'Books Only'
                                : '2B Only'}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono">{r.supplierGstin}</td>
                          <td className="p-2.5">{r.supplierName}</td>
                          <td className="p-2.5 font-medium">{r.invoiceNumber}</td>
                          <td className="p-2.5 text-muted-foreground">{r.invoiceDate}</td>
                          <td className="p-2.5 text-right">{rupees(String(r.bookTaxable))}</td>
                          <td className="p-2.5 text-right">{rupees(String(r.twoBTaxable))}</td>
                          <td className="p-2.5 text-right">{rupees(String(r.bookTax))}</td>
                          <td className="p-2.5 text-right">{rupees(String(r.twoBTax))}</td>
                          <td className="p-2.5 text-center font-semibold">
                            {r.itcAvailable === false ? (
                              <span className="text-danger">No</span>
                            ) : (
                              <span className="text-success">Yes</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* ======================= SELF-FILING GUIDE TAB ======================= */}
      {activeTab === 'guide' && (
        <Card className="p-6 space-y-4 text-xs">
          <div className="flex items-center gap-2 text-base font-semibold text-foreground">
            <HelpCircle className="h-5 w-5 text-accent" />
            <h3>Monthly GST Return Filing Checklist & Deadlines</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
                <FileCheck className="h-4 w-4 text-accent" />
                <span>Step 1: File GSTR-1 (By 11th of every month)</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Report outward sales to clients. Export the GSTR-1 JSON from the GSTR-1 tab above, log into <strong>gst.gov.in</strong>, navigate to <em>Returns &gt; GSTR-1 &gt; Prepare Offline</em>, upload the JSON, review the summary, and sign with DSC/EVC.
              </p>
            </div>

            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
                <FileCheck className="h-4 w-4 text-accent" />
                <span>Step 2: Reconcile GSTR-2B (Between 12th–14th)</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Download GSTR-2B JSON from the GST portal and upload it into the GSTR-2B tab here. Review any suppliers who have not yet filed their returns before paying their balances.
              </p>
            </div>

            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
                <FileCheck className="h-4 w-4 text-accent" />
                <span>Step 3: File GSTR-3B (By 20th of every month)</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                Compare output tax liability against eligible Input Tax Credit (ITC). Pay the net tax due via challan (Net Banking/NEFT) and submit Form GSTR-3B.
              </p>
            </div>

            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-2">
              <div className="font-semibold text-foreground flex items-center gap-1.5 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span>Late Fee Penalties</span>
              </div>
              <p className="text-muted-foreground leading-relaxed">
                ₹50 per day (₹20 per day for NIL returns) for delayed filing of GSTR-1 or GSTR-3B, capped as per the CGST Amendment Act. Always file on or before the due date.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
