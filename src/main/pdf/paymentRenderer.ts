import PDFDocument from 'pdfkit';
import type { PaymentRenderDTO, RenderVoucherParty } from './paymentRenderDto';
import {
  CONTENT_WIDTH,
  COLOR,
  Doc,
  drawCancelledWatermark,
  drawFooters,
  eyebrow,
  FONT,
  MARGIN,
  PAGE,
  rule,
  SIZE,
  SP,
} from './pdfLayout';

/**
 * Deterministic A4 Receipt / Payment Voucher renderer using pdfkit. Consumes
 * ONLY the immutable render DTO (D-011) — no DB access, no recalculation.
 * Titled RECEIPT VOUCHER or PAYMENT VOUCHER. Shares the modern layout system in
 * pdfLayout.ts with the invoice/order/challan renderers. A voucher is a single
 * short page: company header, party, the money block, and (if any) the list of
 * invoices this voucher was allocated against.
 */

export function renderPaymentPdf(dto: PaymentRenderDTO): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `${dto.title} ${dto.voucher_number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawHeader(doc, dto);
      drawParty(doc, dto);
      drawAmountBlock(doc, dto);
      drawAllocations(doc, dto);
      if (dto.cancelled) drawCancelledWatermark(doc);
      drawFooters(doc, dto.title === 'RECEIPT VOUCHER' ? 'Receipt' : 'Payment');
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('PDF render failed'));
    }
  });
}

function drawHeader(doc: Doc, dto: PaymentRenderDTO): void {
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
    ['Voucher No', dto.voucher_number],
    ['Date', dto.voucher_date],
    ['Mode', dto.mode_label],
  ];
  if (dto.reference_no) meta.push(['Reference', dto.reference_no]);
  drawMetaTable(doc, meta, top + SP.xl);
  const rightBottom = doc.y;

  const y = Math.max(leftBottom, rightBottom) + SP.md;
  rule(doc, y);
  doc.y = y + SP.lg;
}

function drawMetaTable(doc: Doc, rows: Array<[string, string]>, top: number): void {
  const blockW = 250;
  const x = PAGE.width - MARGIN - blockW;
  const labelW = 100;
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

function drawParty(doc: Doc, dto: PaymentRenderDTO): void {
  const top = doc.y;
  partyBlock(doc, dto.party_label, dto.party, MARGIN, top, CONTENT_WIDTH * 0.6);
  doc.y = doc.y + SP.md;
  rule(doc, doc.y);
  doc.y += SP.lg;
}

function partyBlock(doc: Doc, label: string, party: RenderVoucherParty, x: number, y: number, w: number): void {
  eyebrow(doc, label, x, y, w);
  doc.font(FONT.bold).fontSize(SIZE.body + 1).fillColor(COLOR.ink).text(party.name || '—', x, doc.y + SP.xs, {
    width: w,
  });
  doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body);
  const lines = [...party.address_lines];
  if (party.state) lines.push(party.state);
  if (party.gstin) lines.push(`GSTIN: ${party.gstin}`);
  if (lines.length) doc.text(lines.join('\n'), x, doc.y + 2, { width: w, lineGap: 1.5 });
}

function drawAmountBlock(doc: Doc, dto: PaymentRenderDTO): void {
  // Emphasised amount panel spanning the content width.
  const y = doc.y;
  const h = 52;
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, h, 4).fill(COLOR.panel);
  doc.font(FONT.regular).fontSize(SIZE.label).fillColor(COLOR.muted).text('AMOUNT', MARGIN + SP.md, y + SP.sm, {
    characterSpacing: 0.6,
  });
  doc.font(FONT.bold).fontSize(20).fillColor(COLOR.accent).text(`\u20b9 ${dto.amount}`, MARGIN + SP.md, y + 18, {
    width: CONTENT_WIDTH - SP.md * 2,
  });
  doc.y = y + h + SP.md;

  doc.font(FONT.italic).fontSize(SIZE.small).fillColor(COLOR.body).text(
    `Amount in words: ${dto.amount_words}`,
    MARGIN,
    doc.y,
    { width: CONTENT_WIDTH, lineGap: 1.5 },
  );
  doc.y += SP.lg;

  if (dto.remarks) {
    eyebrow(doc, 'Remarks', MARGIN, doc.y, CONTENT_WIDTH);
    doc.font(FONT.regular).fontSize(SIZE.small).fillColor(COLOR.body).text(dto.remarks, MARGIN, doc.y + SP.xs, {
      width: CONTENT_WIDTH,
      lineGap: 1.5,
    });
    doc.y += SP.md;
  }
}

function drawAllocations(doc: Doc, dto: PaymentRenderDTO): void {
  if (dto.allocations.length === 0) return;
  rule(doc, doc.y);
  doc.y += SP.lg;
  eyebrow(doc, 'Applied To Invoices', MARGIN, doc.y, CONTENT_WIDTH);
  doc.y += SP.md;

  // Two-column list: invoice number | amount.
  const amountX = PAGE.width - MARGIN - 140;
  doc.font(FONT.bold).fontSize(SIZE.label).fillColor(COLOR.muted);
  doc.text('INVOICE', MARGIN, doc.y, { width: amountX - MARGIN });
  doc.text('AMOUNT', amountX, doc.y - SIZE.label - 1, { width: 140, align: 'right' });
  doc.y += SP.sm;

  doc.font(FONT.regular).fontSize(SIZE.body).fillColor(COLOR.ink);
  for (const a of dto.allocations) {
    const rowY = doc.y;
    doc.fillColor(COLOR.body).text(a.invoice_number || '—', MARGIN, rowY, { width: amountX - MARGIN });
    doc.fillColor(COLOR.ink).text(a.amount, amountX, rowY, { width: 140, align: 'right' });
    doc.y = rowY + 15;
  }
}
