import PDFDocument from 'pdfkit';
import type { ChallanRenderDTO, RenderParty } from './challanRenderDto';
import {
  CONTENT_WIDTH,
  COLOR,
  Doc,
  drawCancelledWatermark,
  drawFooters,
  FONT,
  hairline,
  MARGIN,
  PAGE,
  SIZE,
  SP,
} from './pdfLayout';

/**
 * Deterministic A4 Delivery Challan renderer using pdfkit. Consumes ONLY the
 * immutable render DTO (D-011) — no DB access, no recalculation.
 *
 * A delivery challan is a movement-of-goods document, NOT a tax invoice: its
 * agenda is delivery. It omits amount/rate columns, the tax summary, monetary
 * totals, and payment/bank details, and foregrounds dispatch logistics —
 * Delivery Mode and Motor Vehicle No. print in large type.
 *
 * Layout goal: make full use of the A4 page. The document is framed as a single
 * bordered card; the header, parties, and dispatch sit in weighted panels; the
 * items table stretches with filler rows to reach a fixed lower region; and a
 * received/authorised acknowledgement row is anchored at the page bottom. This
 * avoids the sparse mid-page whitespace a short challan would otherwise show.
 */

/** Outer card geometry. */
const CARD = {
  x: MARGIN,
  y: MARGIN,
  w: CONTENT_WIDTH,
  bottom: PAGE.height - MARGIN - 24, // leave room for the page footer line
} as const;
/** Inner padding inside the card. */
const PAD = 16;
const INNER_X = CARD.x + PAD;
const INNER_W = CARD.w - PAD * 2;
const INNER_RIGHT = CARD.x + CARD.w - PAD;

/**
 * Challan-local design tokens. Kept local (not in the shared pdfLayout scale)
 * so tuning the challan's readability never affects the invoice/order
 * renderers, which share SIZE/COLOR. Company name (17) and the DELIVERY CHALLAN
 * title (16) intentionally stay at their shared sizes.
 */
const CSIZE = {
  eyebrow: 8.5, // section/eyebrow labels
  body: 9.5, // general body text
  meta: 9, // header meta table
  partyName: 11.5, // consignee / ship-to name
  dispatchLabel: 8.5, // DELIVERY MODE / MOTOR VEHICLE NO.
  dispatchValue: 14.5, // Truck / KA05IOW90 — only slightly larger
  table: 9.5, // item table body
  tableHead: 8.5, // item table header labels
} as const;
const CCOLOR = {
  // Card / panel fills and borders. Tints are deliberately deeper than the
  // 1-2% shared panel token so cards actually read as cards in print/preview,
  // while staying restrained (no strong colour). Borders use a visible slate.
  cardFill: '#f1f5f9', // soft gray card background (parties, remarks)
  cardEdge: '#cbd5e1', // visible card border
  dispatchBg: '#eef2ff', // delivery band background (subtle indigo tint)
  dispatchEdge: '#c7d2fe', // delivery band border
  tableHeadFill: '#eef2f6', // neutral gray table header fill
  tableHeadEdge: '#cbd5e1',
  tableHeadText: '#475569', // muted header labels (never indigo)
  cardPad: 15, // inner padding for cards/panels (14–16pt)
} as const;

/** Render the challan to a PDF Buffer. */
export function renderChallanPdf(dto: ChallanRenderDTO): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: { Title: `Delivery Challan ${dto.challan_number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawCard(doc);
      drawHeader(doc, dto);
      drawParties(doc, dto);
      drawDispatch(doc, dto);
      // The table starts right after dispatch.
      const tableStart = doc.y;

      // The items table fills the page down to a limit that reserves the
      // lower region. Only a MINIMUM remarks height is reserved, so the table
      // can hold a reasonable number of rows before overflowing; any leftover
      // whitespace is then absorbed by expanding the remarks panel. The same
      // limit applies to every page, so whichever page ends up last always has
      // room for the signature block.
      // The table limit reserves only a small remarks floor plus the signature
      // row, so a normal number of items stays on one page. After the items are
      // placed, the remarks panel expands to fill the leftover whitespace up to
      // the signature row pinned near the page bottom: few items -> a large
      // remarks area; many items -> remarks shrinks toward its floor.
      const minLowerH = REMARKS_FLOOR_H + SP.lg + ACK_H;
      const bodyBottom = CARD.bottom - PAD - minLowerH - SP.lg;
      drawLineItems(doc, dto, tableStart, bodyBottom);
      const lowerTop = doc.y + SP.lg;
      const ackTop = CARD.bottom - PAD - ACK_H;
      const remarksH = Math.max(REMARKS_FLOOR_H, ackTop - SP.lg - lowerTop);
      drawLowerRegion(doc, dto, lowerTop, remarksH, ackTop);

      if (dto.cancelled) drawCancelledWatermark(doc);
      drawFooters(doc, 'Delivery Challan');
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('PDF render failed'));
    }
  });
}

/** The full-page bordered card that frames the whole document. */
function drawCard(doc: Doc): void {
  doc
    .roundedRect(CARD.x, CARD.y, CARD.w, CARD.bottom - CARD.y, 6)
    .lineWidth(1)
    .strokeColor(COLOR.line)
    .stroke();
}

/** Horizontal divider spanning the inner card width. */
function innerRule(doc: Doc, y: number): void {
  doc
    .moveTo(INNER_X, y)
    .lineTo(INNER_RIGHT, y)
    .lineWidth(0.75)
    .strokeColor(COLOR.line)
    .stroke();
}

function drawHeader(doc: Doc, dto: ChallanRenderDTO): void {
  const top = CARD.y + PAD;
  doc.fillColor(COLOR.ink).font(FONT.bold).fontSize(SIZE.companyName).text(dto.company.name, INNER_X, top, {
    width: INNER_W * 0.55,
  });
  doc.font(FONT.regular).fontSize(CSIZE.body).fillColor(COLOR.muted);
  const companyLines = [...dto.company.address_lines];
  if (dto.company.state) companyLines.push(dto.company.state);
  if (dto.company.gstin) companyLines.push(`GSTIN: ${dto.company.gstin}`);
  doc.text(companyLines.join('\n'), INNER_X, doc.y + SP.xs, { width: INNER_W * 0.52, lineGap: 2 });
  const leftBottom = doc.y;

  doc.font(FONT.bold).fontSize(SIZE.title).fillColor(COLOR.accent).text('DELIVERY CHALLAN', INNER_X, top, {
    width: INNER_W,
    align: 'right',
  });
  const meta: Array<[string, string]> = [
    ['Challan No', dto.challan_number],
    ['Date', dto.challan_date],
    ['Type', `${dto.direction_label} — ${dto.challan_type_label}`],
  ];
  if (dto.place_of_supply) meta.push(['Place of Supply', dto.place_of_supply]);
  drawMetaTable(doc, meta, top + SP.xl);
  const rightBottom = doc.y;

  // Subtle vertical divider between the two header columns.
  const dividerX = INNER_X + INNER_W * 0.55;
  doc
    .moveTo(dividerX, top + 2)
    .lineTo(dividerX, Math.max(leftBottom, rightBottom))
    .lineWidth(0.75)
    .strokeColor(COLOR.hair)
    .stroke();

  const y = Math.max(leftBottom, rightBottom) + SP.md;
  innerRule(doc, y);
  doc.y = y + SP.lg;
}

function drawMetaTable(doc: Doc, rows: Array<[string, string]>, top: number): void {
  const blockW = 260;
  const x = INNER_RIGHT - blockW;
  const labelW = 100;
  const valueW = blockW - labelW - SP.md;
  let y = top;
  for (const [label, value] of rows) {
    doc.font(FONT.regular).fontSize(CSIZE.meta).fillColor(COLOR.muted).text(label, x, y, {
      width: labelW,
      align: 'right',
    });
    doc.font(FONT.bold).fontSize(CSIZE.meta).fillColor(COLOR.ink).text(value, x + labelW + SP.md, y, {
      width: valueW,
      align: 'right',
    });
    y = doc.y + 4;
  }
  doc.y = y;
}

/** Consignee + Ship-To in two equal soft-gray cards that share a common height. */
function drawParties(doc: Doc, dto: ChallanRenderDTO): void {
  const gap = SP.md;
  const colW = (INNER_W - gap) / 2;
  const cpad = CCOLOR.cardPad;
  const top = doc.y;

  // Measure both blocks to a shared card height, then draw the cards.
  const h = Math.max(
    measureParty(doc, dto.party, colW, cpad),
    measureParty(doc, dto.ship_to, colW, cpad),
  );
  const panelH = h + cpad * 2;

  panel(doc, INNER_X, top, colW, panelH);
  panel(doc, INNER_X + colW + gap, top, colW, panelH);

  partyBlock(doc, dto.party_label, dto.party, INNER_X + cpad, top + cpad, colW - cpad * 2);
  partyBlock(doc, 'Ship To', dto.ship_to, INNER_X + colW + gap + cpad, top + cpad, colW - cpad * 2);

  doc.y = top + panelH + SP.lg;
}

/** A soft-filled rounded card background with a visible border. */
function panel(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.roundedRect(x, y, w, h, 6).lineWidth(0.9).fillAndStroke(CCOLOR.cardFill, CCOLOR.cardEdge);
  doc.fillColor(COLOR.ink);
}

/** Compute the rendered height of a party block without drawing it. */
function measureParty(doc: Doc, party: RenderParty, w: number, cpad: number): number {
  const innerW = w - cpad * 2;
  let h = CSIZE.eyebrow + SP.xs; // eyebrow
  doc.font(FONT.bold).fontSize(CSIZE.partyName);
  h += doc.heightOfString(party.name, { width: innerW }) + 3;
  const lines = [...party.address_lines];
  if (party.state) lines.push(party.state);
  if (party.gstin) lines.push(`GSTIN: ${party.gstin}`);
  if (lines.length) {
    doc.font(FONT.regular).fontSize(CSIZE.body);
    h += doc.heightOfString(lines.join('\n'), { width: innerW, lineGap: 2 });
  }
  return h;
}

function partyBlock(doc: Doc, label: string, party: RenderParty, x: number, y: number, w: number): void {
  challanEyebrow(doc, label, x, y, w);
  doc.font(FONT.bold).fontSize(CSIZE.partyName).fillColor(COLOR.ink).text(party.name, x, doc.y + SP.xs, { width: w });
  doc.font(FONT.regular).fontSize(CSIZE.body).fillColor(COLOR.body);
  const lines = [...party.address_lines];
  if (party.state) lines.push(party.state);
  if (party.gstin) lines.push(`GSTIN: ${party.gstin}`);
  if (lines.length) doc.text(lines.join('\n'), x, doc.y + 3, { width: w, lineGap: 2 });
}

/** Challan-local eyebrow at the challan's slightly larger label size. */
function challanEyebrow(doc: Doc, text: string, x: number, y: number, width: number): void {
  doc
    .font(FONT.bold)
    .fontSize(CSIZE.eyebrow)
    .fillColor(COLOR.muted)
    .text(text.toUpperCase(), x, y, { width, characterSpacing: 0.6 });
}

/**
 * Dispatch logistics — the primary agenda of a delivery challan. Rendered as a
 * prominent accent-tinted band with Delivery Mode and Motor Vehicle No. in
 * large type. Secondary metadata (reason for e-Way, order ref) sits below.
 */
function drawDispatch(doc: Doc, dto: ChallanRenderDTO): void {
  const top = doc.y;
  const bandH = 66;
  doc.roundedRect(INNER_X, top, INNER_W, bandH, 6).lineWidth(0.9).fillAndStroke(CCOLOR.dispatchBg, CCOLOR.dispatchEdge);
  doc.fillColor(COLOR.ink);

  const cpad = CCOLOR.cardPad;
  const halfW = INNER_W / 2;
  const colW = halfW - cpad - SP.md;
  const cx1 = INNER_X + cpad;
  const cx2 = INNER_X + halfW + SP.md;

  // Subtle vertical divider between the two dispatch columns.
  doc
    .moveTo(INNER_X + halfW, top + SP.md)
    .lineTo(INNER_X + halfW, top + bandH - SP.md)
    .lineWidth(0.75)
    .strokeColor(CCOLOR.dispatchEdge)
    .stroke();

  // label + prominent value; optional muted sub-line beneath the value.
  const column = (label: string, value: string, sub: string, x: number) => {
    doc.font(FONT.bold).fontSize(CSIZE.dispatchLabel).fillColor(COLOR.muted).text(label.toUpperCase(), x, top + SP.md, {
      width: colW,
      characterSpacing: 0.6,
    });
    doc.font(FONT.bold).fontSize(CSIZE.dispatchValue).fillColor(COLOR.ink).text(value || '—', x, top + SP.md + 13, {
      width: colW,
      ellipsis: true,
      lineBreak: false,
    });
    if (sub) {
      doc.font(FONT.regular).fontSize(CSIZE.eyebrow).fillColor(COLOR.muted).text(sub, x, top + SP.md + 32, {
        width: colW,
        ellipsis: true,
        lineBreak: false,
      });
    }
  };

  const leftSub = dto.source_order_number ? `Order Ref: ${dto.source_order_number}` : '';
  const rightSub = dto.reason_for_eway ? `Reason for e-Way: ${dto.reason_for_eway}` : '';
  column('Delivery Mode', dto.delivery_mode, leftSub, cx1);
  column('Motor Vehicle No.', dto.vehicle_no, rightSub, cx2);

  doc.y = top + bandH + SP.md;
}

const COLS = {
  sn: 34,
  desc: INNER_W - (34 + 130 + 110),
  hsn: 130,
  qty: 110,
};
const ROW_H = 26;
const HEAD_H = 24;

/**
 * Line items. The table body stretches down to `bodyBottom` using blank filler
 * rows so the goods table occupies the full available height instead of
 * leaving the page half-empty. Column guides are drawn for a form-like look.
 */
/**
 * Line items. The table takes only the height its real rows need (no filler
 * rows); the leftover vertical space is absorbed by the expanding remarks
 * panel below. `bodyBottom` is the overflow threshold — when the next row would
 * cross it, the table continues on a new page.
 */
function drawLineItems(doc: Doc, dto: ChallanRenderDTO, tableStart: number, bodyBottom: number): void {
  doc.y = tableStart;
  drawLineHeader(doc);
  let tableTop = doc.y;
  doc.font(FONT.regular).fontSize(CSIZE.table).fillColor(COLOR.ink);

  let y = tableTop;
  dto.lines.forEach((line) => {
    if (y + ROW_H > bodyBottom) {
      // Overflow: close the current table frame and continue on a new page.
      finishTableFrame(doc, tableTop, y, true);
      doc.addPage();
      drawCard(doc);
      doc.y = CARD.y + PAD;
      drawLineHeader(doc);
      tableTop = doc.y;
      y = tableTop;
    }
    drawRow(doc, line, y);
    y += ROW_H;
    hairline(doc, y);
  });

  finishTableFrame(doc, tableTop, y, true);
  doc.y = y;
}

function drawRow(doc: Doc, line: ChallanRenderDTO['lines'][number], y: number): void {
  const cy = y + (ROW_H - CSIZE.table) / 2;
  let x = INNER_X + SP.md;
  doc.font(FONT.regular).fontSize(CSIZE.table);
  doc.fillColor(COLOR.muted).text(String(line.serial), x, cy, { width: COLS.sn - SP.md });
  x += COLS.sn;
  doc.fillColor(COLOR.ink).text(line.description, x, cy, { width: COLS.desc - SP.md, ellipsis: true, lineBreak: false });
  x += COLS.desc;
  doc.fillColor(COLOR.ink).text(line.hsn_sac, x, cy, { width: COLS.hsn - SP.md });
  x += COLS.hsn;
  doc.fillColor(COLOR.ink).font(FONT.bold).text(`${line.quantity} ${line.unit}`, x, cy, { width: COLS.qty - SP.md });
  doc.font(FONT.regular);
}

/** Draw the vertical column separators and the enclosing table bottom border. */
function finishTableFrame(doc: Doc, headTop: number, bottom: number, drawVerticals: boolean): void {
  if (drawVerticals) {
    const xs = [INNER_X + COLS.sn, INNER_X + COLS.sn + COLS.desc, INNER_X + COLS.sn + COLS.desc + COLS.hsn];
    doc.lineWidth(0.4).strokeColor(COLOR.hair);
    for (const vx of xs) {
      doc.moveTo(vx, headTop).lineTo(vx, bottom).stroke();
    }
  }
  doc.lineWidth(0.75).strokeColor(COLOR.line);
  doc.moveTo(INNER_X, bottom).lineTo(INNER_RIGHT, bottom).stroke();
}

function drawLineHeader(doc: Doc): void {
  const y = doc.y;
  const h = HEAD_H;
  // Neutral, understated header: light gray fill, muted bold labels — no
  // accent/indigo. Keeps the table quiet and un-invoice-like.
  doc.roundedRect(INNER_X, y, INNER_W, h, 3).lineWidth(0.8).fillAndStroke(CCOLOR.tableHeadFill, CCOLOR.tableHeadEdge);
  doc.fillColor(CCOLOR.tableHeadText).font(FONT.bold).fontSize(CSIZE.tableHead);
  let x = INNER_X + SP.md;
  const head = (label: string, w: number) => {
    doc.text(label, x, y + 8, { width: w - SP.md, characterSpacing: 0.5 });
    x += w;
  };
  head('#', COLS.sn);
  head('DESCRIPTION', COLS.desc);
  head('HSN/SAC', COLS.hsn);
  head('QTY', COLS.qty);
  doc.y = y + h;
  doc.fillColor(COLOR.ink);
}

/**
 * Lower region sizing. The Remarks panel has a large minimum (~150pt) and grows
 * to fill any leftover whitespace, so the document uses its lower area
 * deliberately — ample room for transport notes, handling instructions,
 * delivery conditions, damage observations, and terms. The acknowledgement /
 * signature row is a fixed height pinned near the page bottom.
 */
/**
 * Floor height reserved for remarks when sizing the table. Kept small so a
 * normal number of items fits on one page; the panel then expands to fill any
 * leftover whitespace (typically to ~150-220pt for short challans).
 */
const REMARKS_FLOOR_H = 60;
const ACK_H = 66;

/**
 * Draw the lower region: a soft-gray remarks panel of height `remarksH` at
 * `top`, and the acknowledgement / signature row starting at `ackTop`. Nothing
 * here depends on the number of line items.
 */
function drawLowerRegion(doc: Doc, dto: ChallanRenderDTO, top: number, remarksH: number, ackTop: number): void {
  const cpad = CCOLOR.cardPad;
  const remarksTop = top;

  // --- Remarks (large soft-gray panel) ---
  const remarks = [dto.notes, dto.terms].filter(Boolean).join('\n');
  doc.roundedRect(INNER_X, remarksTop, INNER_W, remarksH, 6).lineWidth(0.9).fillAndStroke(CCOLOR.cardFill, CCOLOR.cardEdge);
  challanEyebrow(doc, 'Remarks', INNER_X + cpad, remarksTop + cpad, INNER_W - cpad * 2);
  if (remarks) {
    doc.font(FONT.regular).fontSize(CSIZE.body).fillColor(COLOR.body).text(remarks, INNER_X + cpad, remarksTop + cpad + 16, {
      width: INNER_W - cpad * 2,
      height: remarksH - cpad * 2 - 16,
      lineGap: 2,
      ellipsis: true,
    });
  }

  // --- Acknowledgement row: Received By | For <Company> / Authorised Signatory ---
  const gap = SP.lg;
  const colW = (INNER_W - gap) / 2;
  const sigLineY = ackTop + ACK_H - 16;

  // Subtle vertical divider between the two signature columns.
  doc
    .moveTo(INNER_X + colW + gap / 2, ackTop)
    .lineTo(INNER_X + colW + gap / 2, ackTop + ACK_H)
    .lineWidth(0.75)
    .strokeColor(COLOR.hair)
    .stroke();

  // Received by (left)
  challanEyebrow(doc, 'Received in good condition', INNER_X, ackTop, colW);
  doc.lineWidth(0.6).strokeColor(COLOR.faint).moveTo(INNER_X, sigLineY).lineTo(INNER_X + colW - SP.lg, sigLineY).stroke();
  doc.font(FONT.regular).fontSize(CSIZE.eyebrow).fillColor(COLOR.muted).text('Receiver Signature / Date', INNER_X, sigLineY + 3, {
    width: colW - SP.lg,
  });

  // For company (right)
  const rightX = INNER_X + colW + gap;
  challanEyebrow(doc, `For ${dto.company.name}`, rightX, ackTop, colW);
  doc.lineWidth(0.6).strokeColor(COLOR.faint).moveTo(rightX + SP.lg, sigLineY).lineTo(INNER_RIGHT, sigLineY).stroke();
  const sigLabel = dto.authorized_signatory
    ? `${dto.authorized_signatory} — Authorized Signatory`
    : 'Authorized Signatory';
  doc.font(FONT.regular).fontSize(CSIZE.eyebrow).fillColor(COLOR.muted).text(sigLabel, rightX, sigLineY + 3, {
    width: colW,
    align: 'right',
  });
}
