import PDFDocument from 'pdfkit';
import type { OrderRenderDTO, RenderParty } from './orderRenderDto';
import {
  CONTENT_WIDTH,
  COLOR,
  Doc,
  drawCancelledWatermark,
  drawFooters,
  ensureSpace,
  eyebrow,
  FONT,
  hairline,
  MARGIN,
  PAGE,
  rule,
  SIZE,
  SP,
} from './pdfLayout';

/**
 * Deterministic A4 order renderer (Sales Order / Purchase Order / Service
 * Request). Consumes ONLY the immutable render DTO — no DB, no recalculation.
 * Titled per the order type; no E-Way Bill field is ever printed. Shares the
 * modern layout system in pdfLayout.ts with the invoice and challan renderers.
 */

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
      drawFooterBlock(doc, dto);
      if (dto.cancelled) drawCancelledWatermark(doc);
      drawFooters(doc, dto.order_type_label);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('PDF render failed'));
    }
  });
}

function drawHeader(doc: Doc, dto: OrderRenderDTO): void {
  const top = MARGIN;
  doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(SIZE.companyName).text(dto.company.name, MARGIN, top, {
    width: CONTENT_WIDTH * 0.55,
  });
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.muted);
  const companyLines = [...dto.company.address_lines];
  if (dto.company.state) companyLines.push(dto.company.state);
  if (dto.company.gstin) companyLines.push(`GSTIN: ${dto.company.gstin}`);
  doc.text(companyLines.join('\n'), MARGIN, doc.y + SP.xs, { width: CONTENT_WIDTH * 0.55, lineGap: 1.5 });
  const leftBottom = doc.y;

  doc.font(FONT.bold).fontSize(SIZE.title).fillColor(COLOR.accent).text(dto.title, MARGIN, top, {
    width: CONTENT_WIDTH,
    align: 'right',
  });
  const meta: Array<[string, string]> = [
    ['No', dto.order_number],
    ['Date', dto.order_date],
  ];
  if (dto.place_of_supply) meta.push(['Place of Supply', dto.place_of_supply]);
  drawMetaTable(doc, meta, top + SP.xl);
  const rightBottom = doc.y;

  const y = Math.max(leftBottom, rightBottom) + SP.md;
  rule(doc, y);
  doc.y = y + SP.lg;
}

function drawMetaTable(doc: Doc, rows: Array<[string, string]>, top: number): void {
  const blockW = 250;
  const x = PAGE.width - MARGIN - blockW;
  const labelW = 110;
  const valueW = blockW - labelW - SP.md;
  let y = top;
  for (const [label, value] of rows) {
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.muted).text(label, x, y, {
      width: labelW,
      align: 'right',
    });
    doc.font(FONT.bold).fontSize(SIZE.small).fillColor(COLOR.ink).text(value, x + labelW + SP.md, y, {
      width: valueW,
      align: 'right',
    });
    y += 13;
  }
  doc.y = y;
}

function drawParties(doc: Doc, dto: OrderRenderDTO): void {
  const top = doc.y;
  const gap = SP.xl;
  const colWidth = (CONTENT_WIDTH - gap) / 2;
  partyBlock(doc, dto.party_label, dto.party, MARGIN, top, colWidth);
  const leftEnd = doc.y;
  partyBlock(doc, 'Ship To', dto.ship_to, MARGIN + colWidth + gap, top, colWidth);
  doc.y = Math.max(leftEnd, doc.y) + SP.md;
  rule(doc, doc.y);
  doc.y += SP.lg;
}

function partyBlock(doc: Doc, label: string, party: RenderParty, x: number, y: number, w: number): void {
  eyebrow(doc, label, x, y, w);
  doc.font(FONT.bold).fontSize(SIZE.body + 1).fillColor(COLOR.ink).text(party.name, x, doc.y + SP.xs, { width: w });
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body);
  const lines = [...party.address_lines];
  if (party.state) lines.push(party.state);
  if (party.gstin) lines.push(`GSTIN: ${party.gstin}`);
  if (lines.length) doc.text(lines.join('\n'), x, doc.y + 2, { width: w, lineGap: 1.5 });
}

function drawMeta(doc: Doc, dto: OrderRenderDTO): void {
  const parts: string[] = [];
  if (dto.delivery_mode) parts.push(`Delivery Mode: ${dto.delivery_mode}`);
  parts.push(`Reverse Charge: ${dto.reverse_charge ? 'Yes' : 'No'}`);
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.muted).text(parts.join('     |     '), MARGIN, doc.y, {
    width: CONTENT_WIDTH,
  });
  doc.y += SP.md;
  rule(doc, doc.y);
  doc.y += SP.lg;
}

const COLS = {
  sn: 26,
  desc: 204,
  hsn: 58,
  qty: 52,
  rate: 74,
  amount: CONTENT_WIDTH - (26 + 204 + 58 + 52 + 74),
};
const ROW_PAD = 7;

function drawLineItems(doc: Doc, dto: OrderRenderDTO): void {
  drawLineHeader(doc);
  doc.font(FONT.regular).fontSize(SIZE.body).fillColor(COLOR.ink);

  dto.lines.forEach((line, idx) => {
    ensureSpace(doc, 44, () => drawLineHeader(doc));
    const startY = doc.y + ROW_PAD;
    let x = MARGIN + SP.xs;
    doc.fillColor(COLOR.muted).text(String(line.serial), x, startY, { width: COLS.sn - SP.xs });
    x += COLS.sn;

    doc.fillColor(COLOR.ink).text(`[${line.item_type_label}] ${line.description}`, x, startY, {
      width: COLS.desc - SP.sm,
    });
    if (line.note) {
      doc.fontSize(SIZE.small).fillColor(COLOR.muted).text(line.note, x, doc.y + 1, { width: COLS.desc - SP.sm });
      doc.fontSize(SIZE.body);
    }
    const descBottom = doc.y;
    x += COLS.desc;

    doc.fillColor(COLOR.body);
    doc.text(line.hsn_sac, x, startY, { width: COLS.hsn });
    x += COLS.hsn;
    doc.text(`${line.quantity} ${line.unit}`, x, startY, { width: COLS.qty });
    x += COLS.qty;
    doc.fillColor(COLOR.ink).text(line.rate, x, startY, { width: COLS.rate - SP.sm, align: 'right' });
    x += COLS.rate;
    doc.font(FONT.bold).text(line.amount, x, startY, { width: COLS.amount - SP.xs, align: 'right' });
    doc.font(FONT.regular);

    doc.y = Math.max(descBottom, startY + 12) + ROW_PAD;
    if (idx < dto.lines.length - 1) hairline(doc, doc.y);
  });
  doc.y += SP.xs;
  rule(doc, doc.y);
}

function drawLineHeader(doc: Doc): void {
  const y = doc.y;
  const h = 20;
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, h, 3).fill(COLOR.panel);
  doc.fillColor(COLOR.muted).font(FONT.bold).fontSize(SIZE.label);
  let x = MARGIN + SP.xs;
  const head = (label: string, w: number, align: 'left' | 'right' = 'left') => {
    doc.text(label, x, y + 6.5, { width: w - SP.sm, align, characterSpacing: 0.4 });
    x += w;
  };
  head('#', COLS.sn);
  head('DESCRIPTION', COLS.desc);
  head('HSN/SAC', COLS.hsn);
  head('QTY', COLS.qty);
  head('RATE', COLS.rate, 'right');
  head('AMOUNT', COLS.amount, 'right');
  doc.y = y + h + SP.xs;
  doc.fillColor(COLOR.ink);
}

function drawTaxSummary(doc: Doc, dto: OrderRenderDTO): void {
  if (dto.tax_summary.length === 0) return;
  ensureSpace(doc, 70);
  doc.y += SP.lg;
  eyebrow(doc, 'Tax Summary', MARGIN, doc.y, CONTENT_WIDTH);
  doc.y += SP.md;
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body);
  for (const row of dto.tax_summary) {
    const parts = [`HSN/SAC ${row.hsn_sac}`, `Taxable ${row.taxable_value}`];
    if (dto.is_intra_state) {
      parts.push(`CGST ${row.cgst_rate}% ${row.cgst_amount}`);
      parts.push(`SGST ${row.sgst_rate}% ${row.sgst_amount}`);
    } else {
      parts.push(`IGST ${row.igst_rate}% ${row.igst_amount}`);
    }
    parts.push(`Tax ${row.total_tax}`);
    doc.text(parts.join('      '), MARGIN, doc.y, { width: CONTENT_WIDTH });
    doc.y += SP.xs;
  }
  doc.y += SP.sm;
}

function drawTotals(doc: Doc, dto: OrderRenderDTO): void {
  ensureSpace(doc, 130);
  const boxWidth = 250;
  const x = PAGE.width - MARGIN - boxWidth;
  rule(doc, doc.y);
  doc.y += SP.md;
  const totalsTop = doc.y;

  const line = (label: string, value: string) => {
    const rowY = doc.y;
    doc.font(FONT.regular).fontSize(SIZE.body).fillColor(COLOR.muted).text(label, x, rowY, { width: boxWidth * 0.5 });
    doc.fillColor(COLOR.ink).text(value, x + boxWidth * 0.5, rowY, { width: boxWidth * 0.5, align: 'right' });
    doc.y = rowY + 15;
  };

  line('Taxable Value', dto.totals.taxable);
  if (dto.is_intra_state) {
    line('CGST', dto.totals.cgst);
    line('SGST', dto.totals.sgst);
  } else {
    line('IGST', dto.totals.igst);
  }
  line('Round-Off', dto.totals.round_off);

  doc.y += SP.xs;
  const gy = doc.y;
  doc.roundedRect(x, gy, boxWidth, 26, 3).fill(COLOR.panel);
  doc.font(FONT.bold).fontSize(SIZE.grand).fillColor(COLOR.accent);
  doc.text('Grand Total', x + SP.md, gy + 7, { width: boxWidth * 0.5 });
  doc.text(dto.totals.grand_total, x + boxWidth * 0.5, gy + 7, {
    width: boxWidth * 0.5 - SP.md,
    align: 'right',
  });
  const totalsBottom = gy + 26;

  doc.font(FONT.italic).fontSize(SIZE.small).fillColor(COLOR.body);
  doc.text(`Amount in words: ${dto.grand_total_words}`, MARGIN, totalsTop, {
    width: x - MARGIN - SP.lg,
    lineGap: 1.5,
  });
  doc.text(`Tax in words: ${dto.tax_amount_words}`, MARGIN, doc.y + SP.sm, {
    width: x - MARGIN - SP.lg,
    lineGap: 1.5,
  });

  doc.y = Math.max(doc.y, totalsBottom) + SP.lg;
}

function drawFooterBlock(doc: Doc, dto: OrderRenderDTO): void {
  ensureSpace(doc, 110);
  rule(doc, doc.y);
  doc.y += SP.lg;

  const leftX = MARGIN;
  const rightX = PAGE.width / 2 + SP.md;
  const top = doc.y;
  const colW = PAGE.width / 2 - MARGIN - SP.md;

  const bankLines: string[] = [];
  if (dto.bank.bank_name) bankLines.push(`Bank: ${dto.bank.bank_name}`);
  if (dto.bank.account_number) bankLines.push(`A/C: ${dto.bank.account_number}`);
  if (dto.bank.branch) bankLines.push(`Branch: ${dto.bank.branch}`);
  if (dto.bank.ifsc) bankLines.push(`IFSC: ${dto.bank.ifsc}`);
  if (dto.upi_id) bankLines.push(`UPI: ${dto.upi_id}`);
  if (bankLines.length) {
    eyebrow(doc, 'Bank Details', leftX, top, colW);
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body).text(bankLines.join('\n'), leftX, doc.y + SP.xs, {
      width: colW,
      lineGap: 1.5,
    });
  }

  eyebrow(doc, `For ${dto.company.name}`, rightX, top, colW);
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.muted).text('\n\nAuthorized Signatory', rightX, doc.y, {
    width: colW,
    align: 'right',
  });
  if (dto.authorized_signatory) {
    doc.fillColor(COLOR.ink).text(dto.authorized_signatory, rightX, doc.y + SP.xs, { width: colW, align: 'right' });
  }

  doc.y = Math.max(doc.y, top + 72) + SP.md;

  const block = (label: string, value: string) => {
    if (!value) return;
    ensureSpace(doc, 48);
    eyebrow(doc, label, MARGIN, doc.y, CONTENT_WIDTH);
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body).text(value, MARGIN, doc.y + SP.xs, {
      width: CONTENT_WIDTH,
      lineGap: 1.5,
    });
    doc.y += SP.md;
  };
  block('Notes', dto.notes);
  block('Terms & Conditions', dto.terms);
}
