import PDFDocument from 'pdfkit';
import type { OrderRenderDTO, RenderParty } from './orderRenderDto';

/**
 * Deterministic A4 order renderer (Sales Order / Purchase Order / Service
 * Request). Consumes ONLY the immutable render DTO — no DB, no recalculation.
 * Titled per the order type; no E-Way Bill field is ever printed.
 */

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - MARGIN * 2;

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = '#cbd5e1';
const ACCENT = '#4f46e5';

type Doc = InstanceType<typeof PDFDocument>;

export function renderOrderPdf(dto: OrderRenderDTO): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${dto.order_type_label} ${dto.order_number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, dto);
      drawParties(doc, dto);
      drawMeta(doc, dto);
      drawLineItems(doc, dto);
      drawTaxSummary(doc, dto);
      drawTotals(doc, dto);
      drawFooter(doc, dto);
      if (dto.cancelled) drawCancelledWatermark(doc);
      addPageNumbers(doc, dto);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('PDF render failed'));
    }
  });
}

function drawHeader(doc: Doc, dto: OrderRenderDTO): void {
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(18).text(dto.company.name, MARGIN, MARGIN);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const companyLines = [...dto.company.address_lines];
  if (dto.company.state) companyLines.push(dto.company.state);
  if (dto.company.gstin) companyLines.push(`GSTIN: ${dto.company.gstin}`);
  doc.text(companyLines.join('\n'), MARGIN, doc.y + 2, { width: 300 });

  doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text(dto.title, MARGIN, MARGIN, {
    width: CONTENT_WIDTH,
    align: 'right',
  });
  doc.font('Helvetica').fontSize(9).fillColor(INK);
  const meta = [
    `No: ${dto.order_number}`,
    `Date: ${dto.order_date}`,
    dto.place_of_supply ? `Place of Supply: ${dto.place_of_supply}` : '',
  ].filter(Boolean);
  doc.text(meta.join('\n'), MARGIN, MARGIN + 26, { width: CONTENT_WIDTH, align: 'right' });

  const y = Math.max(doc.y, MARGIN + 90) + 6;
  hr(doc, y);
  doc.y = y + 8;
}

function drawParties(doc: Doc, dto: OrderRenderDTO): void {
  const top = doc.y;
  const colWidth = (CONTENT_WIDTH - 20) / 2;
  partyBlock(doc, dto.party_label, dto.party, MARGIN, top, colWidth);
  const leftEnd = doc.y;
  partyBlock(doc, 'SHIP TO', dto.ship_to, MARGIN + colWidth + 20, top, colWidth);
  doc.y = Math.max(leftEnd, doc.y) + 6;
  hr(doc, doc.y);
  doc.y += 8;
}

function partyBlock(doc: Doc, label: string, party: RenderParty, x: number, y: number, w: number): void {
  doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(label, x, y, { width: w });
  doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(party.name, x, doc.y + 1, { width: w });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  const lines = [...party.address_lines];
  if (party.state) lines.push(party.state);
  if (party.gstin) lines.push(`GSTIN: ${party.gstin}`);
  if (lines.length) doc.text(lines.join('\n'), x, doc.y + 1, { width: w });
}

function drawMeta(doc: Doc, dto: OrderRenderDTO): void {
  const parts: string[] = [];
  if (dto.delivery_mode) parts.push(`Delivery Mode: ${dto.delivery_mode}`);
  parts.push(`Reverse Charge: ${dto.reverse_charge ? 'Yes' : 'No'}`);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(parts.join('   |   '), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.y += 6;
  hr(doc, doc.y);
  doc.y += 8;
}

const COLS = {
  sn: 24,
  desc: 200,
  hsn: 58,
  qty: 52,
  rate: 74,
  amount: CONTENT_WIDTH - (24 + 200 + 58 + 52 + 74),
};

function drawLineItems(doc: Doc, dto: OrderRenderDTO): void {
  drawLineHeader(doc);
  doc.font('Helvetica').fontSize(9).fillColor(INK);

  for (const line of dto.lines) {
    ensureSpace(doc, 40, () => drawLineHeader(doc));
    const startY = doc.y;
    let x = MARGIN;
    doc.text(String(line.serial), x, startY, { width: COLS.sn });
    x += COLS.sn;

    const head = `[${line.item_type_label}] ${line.description}`;
    const descText = line.note ? `${head}\n${line.note}` : head;
    doc.text(descText, x, startY, { width: COLS.desc });
    const descBottom = doc.y;
    x += COLS.desc;

    doc.text(line.hsn_sac, x, startY, { width: COLS.hsn });
    x += COLS.hsn;
    doc.text(`${line.quantity} ${line.unit}`, x, startY, { width: COLS.qty });
    x += COLS.qty;
    doc.text(line.rate, x, startY, { width: COLS.rate, align: 'right' });
    x += COLS.rate;
    doc.text(line.amount, x, startY, { width: COLS.amount, align: 'right' });

    doc.y = Math.max(descBottom, startY + 12) + 4;
    hrLight(doc, doc.y - 2);
  }
}

function drawLineHeader(doc: Doc): void {
  const y = doc.y;
  doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill('#f1f5f9');
  doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
  let x = MARGIN + 2;
  const head = (label: string, w: number, align: 'left' | 'right' = 'left') => {
    doc.text(label, x, y + 5, { width: w - 4, align });
    x += w;
  };
  head('#', COLS.sn);
  head('DESCRIPTION', COLS.desc);
  head('HSN/SAC', COLS.hsn);
  head('QTY', COLS.qty);
  head('RATE', COLS.rate, 'right');
  head('AMOUNT', COLS.amount, 'right');
  doc.y = y + 20;
  doc.fillColor(INK);
}

function drawTaxSummary(doc: Doc, dto: OrderRenderDTO): void {
  if (dto.tax_summary.length === 0) return;
  ensureSpace(doc, 60);
  doc.y += 4;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(INK).text('Tax Summary', MARGIN, doc.y);
  doc.y += 4;
  doc.font('Helvetica').fontSize(8).fillColor(INK);
  for (const row of dto.tax_summary) {
    const parts = [`HSN/SAC ${row.hsn_sac}`, `Taxable ${row.taxable_value}`];
    if (dto.is_intra_state) {
      parts.push(`CGST ${row.cgst_rate}% ${row.cgst_amount}`);
      parts.push(`SGST ${row.sgst_rate}% ${row.sgst_amount}`);
    } else {
      parts.push(`IGST ${row.igst_rate}% ${row.igst_amount}`);
    }
    parts.push(`Tax ${row.total_tax}`);
    doc.text(parts.join('   '), MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.y += 2;
  }
  doc.y += 4;
}

function drawTotals(doc: Doc, dto: OrderRenderDTO): void {
  ensureSpace(doc, 120);
  const boxWidth = 240;
  const x = PAGE.width - MARGIN - boxWidth;
  hr(doc, doc.y);
  doc.y += 6;
  const totalsTop = doc.y;

  const row = (label: string, value: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9);
    doc.fillColor(bold ? ACCENT : MUTED).text(label, x, doc.y, { width: boxWidth / 2 });
    doc
      .fillColor(bold ? ACCENT : INK)
      .text(value, x + boxWidth / 2, doc.y - (bold ? 13 : 11), {
        width: boxWidth / 2,
        align: 'right',
      });
    doc.y += bold ? 4 : 2;
  };

  row('Taxable Value', dto.totals.taxable);
  if (dto.is_intra_state) {
    row('CGST', dto.totals.cgst);
    row('SGST', dto.totals.sgst);
  } else {
    row('IGST', dto.totals.igst);
  }
  row('Round-Off', dto.totals.round_off);
  hrLight(doc, doc.y + 2);
  doc.y += 6;
  row('Grand Total', dto.totals.grand_total, true);

  doc.font('Helvetica-Oblique').fontSize(8).fillColor(MUTED);
  doc.text(`Amount in words: ${dto.grand_total_words}`, MARGIN, totalsTop, { width: x - MARGIN - 10 });
  doc.text(`Tax in words: ${dto.tax_amount_words}`, MARGIN, doc.y + 2, { width: x - MARGIN - 10 });

  doc.y = Math.max(doc.y, totalsTop + 70) + 6;
}

function drawFooter(doc: Doc, dto: OrderRenderDTO): void {
  ensureSpace(doc, 140);
  hr(doc, doc.y);
  doc.y += 8;

  const leftX = MARGIN;
  const rightX = PAGE.width / 2 + 10;
  const top = doc.y;
  const colW = PAGE.width / 2 - MARGIN - 10;

  const bankLines: string[] = [];
  if (dto.bank.bank_name) bankLines.push(`Bank: ${dto.bank.bank_name}`);
  if (dto.bank.account_number) bankLines.push(`A/C: ${dto.bank.account_number}`);
  if (dto.bank.branch) bankLines.push(`Branch: ${dto.bank.branch}`);
  if (dto.bank.ifsc) bankLines.push(`IFSC: ${dto.bank.ifsc}`);
  if (dto.upi_id) bankLines.push(`UPI: ${dto.upi_id}`);
  if (bankLines.length) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text('BANK DETAILS', leftX, top, { width: colW });
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(bankLines.join('\n'), leftX, doc.y + 1, { width: colW });
  }

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`For ${dto.company.name}`, rightX, top, {
    width: colW,
    align: 'right',
  });
  doc.text('\n\nAuthorized Signatory', rightX, doc.y, { width: colW, align: 'right' });
  if (dto.authorized_signatory) {
    doc.fillColor(INK).text(dto.authorized_signatory, rightX, doc.y + 1, { width: colW, align: 'right' });
  }

  doc.y = Math.max(doc.y, top + 70) + 6;

  const block = (label: string, value: string) => {
    if (!value) return;
    ensureSpace(doc, 40);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED).text(label, MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.font('Helvetica').fontSize(8).fillColor(INK).text(value, MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
    doc.y += 4;
  };
  block('NOTES', dto.notes);
  block('TERMS & CONDITIONS', dto.terms);
}

function drawCancelledWatermark(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc
      .font('Helvetica-Bold')
      .fontSize(90)
      .fillColor('#ef4444')
      .opacity(0.14)
      .text('CANCELLED', 0, PAGE.height / 2 - 60, { width: PAGE.width, align: 'center' });
    doc.opacity(1).restore();
  }
}

function addPageNumbers(doc: Doc, dto: OrderRenderDTO): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor(MUTED)
      .text(
        `This is a Computer Generated ${dto.order_type_label}          Page ${i + 1} of ${range.count}`,
        MARGIN,
        PAGE.height - MARGIN + 8,
        { width: CONTENT_WIDTH, align: 'center' },
      );
  }
}

function hr(doc: Doc, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.8).strokeColor(LINE).stroke();
}
function hrLight(doc: Doc, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
}
function ensureSpace(doc: Doc, needed: number, onNewPage?: () => void): void {
  if (doc.y + needed > PAGE.height - MARGIN - 20) {
    doc.addPage();
    doc.y = MARGIN;
    if (onNewPage) onNewPage();
  }
}
