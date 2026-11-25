import PDFDocument from 'pdfkit';
import type { InvoiceRenderDTO, RenderParty } from './renderDto';
import {
  drawCancelledWatermark,
  drawTallyFooter,
  PAGE,
  registerTallyFonts,
  setActiveTallyFonts,
  TALLY,
  tallyFont,
  tallyHasRupee,
  tallyLine,
  tallyRect,
  tallyText,
  tallyTextHeight,
  tallyTitle,
} from './pdfLayout';

/**
 * Deterministic A4 GST tax-invoice renderer (pdfkit) in the traditional Tally
 * layout: a single fully-bordered box, compact black-on-white typography, no
 * accent colour, no rounded panels. Consumes ONLY the immutable render DTO
 * (DECISIONS D-011) — no DB access, no recalculation.
 *
 * Structure (matches the reference invoice):
 *   centred "Tax Invoice" title
 *   ┌───────────────────────────┬───────────────────────────┐
 *   │ Seller (name/addr/GSTIN)  │ Invoice No. | Dated        │
 *   │ Consignee (Ship to)       │ metadata grid (references) │
 *   │ Buyer (Bill to)           │                            │
 *   ├──┬──────────┬────┬───┬────┴──┬────┬─────┬──────────────┤
 *   │Sl│ Desc     │HSN │Qty│ Rate  │per │Disc%│ Amount       │  line items
 *   │  │ …taxes / round-off inside the amount area…          │
 *   │           Total                    | ₹ grand total     │
 *   ├─────────────────────────────────────────────────────── ┤
 *   │ Amount Chargeable (in words)                    E.&O.E │
 *   ├─────────────────────────────────────────────────────── ┤
 *   │ HSN/SAC | Taxable | CGST r/amt | SGST r/amt | Total tax│  GST summary
 *   │ Tax Amount (in words) : …                              │
 *   ├───────────────────────────┬───────────────────────────┤
 *   │ Declaration               │ Company's Bank Details     │  footer
 *   │                           │ for <Company> / Signatory  │
 *   └───────────────────────────┴───────────────────────────┘
 *   "This is a Computer Generated Invoice" (page footer)
 *
 * The copy marker (Original/Duplicate/Triplicate for …) is stamped from
 * dto.copy_label; it is presentation-only and never alters invoice content.
 */

/**
 * Invoice-only page margin: 12.7 mm (0.5 in = 36 pt) from each page edge to the
 * invoice border, per the approved layout diagram (184.6 x 271.6 mm content
 * area on A4). Intentionally local to the invoice renderer so the shared MARGIN
 * (used by challan/order/payment) is unaffected.
 */
const INV_MARGIN = 36;
const LEFT = INV_MARGIN;
const RIGHT = PAGE.width - INV_MARGIN;
const FULL_W = PAGE.width - INV_MARGIN * 2;
/** Split between the party column (left) and the metadata grid (right). */
const SPLIT = LEFT + FULL_W * 0.52;
const LEFT_W = SPLIT - LEFT;
const RIGHT_W = RIGHT - SPLIT;

/** Line-item column x-positions across the full content width. */
const IC = (() => {
  const sl = 22;
  const hsn = 52;
  const qty = 62;
  const rate = 58;
  const per = 26;
  const disc = 40;
  const amount = 78;
  const desc = FULL_W - (sl + hsn + qty + rate + per + disc + amount);
  const x0 = LEFT;
  const xDesc = x0 + sl;
  const xHsn = xDesc + desc;
  const xQty = xHsn + hsn;
  const xRate = xQty + qty;
  const xPer = xRate + rate;
  const xDisc = xPer + per;
  const xAmount = xDisc + disc;
  return {
    sl,
    desc,
    hsn,
    qty,
    rate,
    per,
    disc,
    amount,
    x0,
    xDesc,
    xHsn,
    xQty,
    xRate,
    xPer,
    xDisc,
    xAmount,
    right: RIGHT,
  };
})();

/**
 * Render one or more invoice copies into a single PDF Buffer. Each entry in
 * `copies` is the same invoice content with a different presentation copy
 * label (Original / Duplicate / Triplicate); every copy starts on a new page.
 * Passing a single copy (the default) produces the ordinary one-copy invoice.
 *
 * All copies share identical invoice content (DECISIONS D-031); only the
 * printed copy marker differs.
 */
export function renderInvoicePdf(
  dto: InvoiceRenderDTO,
  copyLabels: string[] = [dto.copy_label],
): Promise<Buffer> {
  const labels = copyLabels.length > 0 ? copyLabels : [''];
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: INV_MARGIN, bottom: INV_MARGIN, left: INV_MARGIN, right: INV_MARGIN },
      bufferPages: true,
      info: { Title: `Invoice ${dto.invoice_number}` },
    });

    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      // Embed the rupee-capable font once for this document (D-011: still pure
      // presentation — no data access).
      setActiveTallyFonts(registerTallyFonts(doc));
      labels.forEach((label, i) => {
        if (i > 0) doc.addPage();
        drawInvoiceCopy(doc, { ...dto, copy_label: label });
      });
      if (dto.cancelled) drawCancelledWatermark(doc);
      drawTallyFooter(doc, LEFT, FULL_W, INV_MARGIN);
      doc.end();
    } catch (err) {
      reject(err instanceof Error ? err : new Error('PDF render failed'));
    }
  });
}

/**
 * Lay out the full invoice body from `boxTop`, injecting `extraGap` blank space
 * into the line-item area. Returns the y at the bottom of the last section.
 * Used both to draw (on the real doc) and to measure (on a throwaway doc).
 */
function layoutBody(doc: Doc, dto: InvoiceRenderDTO, boxTop: number, extraGap: number): number {
  let y = boxTop;
  y = drawTopBlock(doc, dto, y);
  y = drawItemsHeader(doc, y);
  y = drawItems(doc, dto, y, extraGap);
  y = drawTotalRow(doc, dto, y);
  y = drawAmountInWords(doc, dto, y);
  y = drawTaxSummary(doc, dto, y);
  y = drawTaxInWords(doc, dto, y);
  y = drawFooterBlock(doc, dto, y);
  return y;
}

/** Y at which the invoice box must end so the border sits 12.7 mm from the
 * bottom edge (matching the top/left/right margins). */
const BOX_BOTTOM_LIMIT = PAGE.height - INV_MARGIN;

/** Draw one complete invoice copy on the current page. */
function drawInvoiceCopy(doc: Doc, dto: InvoiceRenderDTO): void {
  let y = INV_MARGIN;
  y = tallyTitle(doc, dto.title, y, LEFT, FULL_W) + 3;
  const boxTop = y;

  // Measure the natural body height (no injected gap) on a throwaway document
  // that shares the same fonts, so we know how much spare vertical space a
  // single-page invoice has before the bottom margin. Restore this document's
  // active fonts afterwards (the probe re-points them at its own doc).
  const naturalBottom = measureBodyBottom(dto, boxTop);
  setActiveTallyFonts(registerTallyFonts(doc));
  // Reserve a safety band so the footer block never flows into the bottom
  // margin (which would make pdfkit append a phantom page). The injected gap is
  // capped to keep the body bottom at least SAFETY pts above the limit.
  const SAFETY = 28;
  const spare = BOX_BOTTOM_LIMIT - SAFETY - naturalBottom;
  const extraGap = spare > 0 ? spare : 0;

  const bottom = layoutBody(doc, dto, boxTop, extraGap);
  // Extend the frame to the bottom margin when we stretched to fill the page;
  // otherwise frame the content exactly (multi-page / full invoices).
  const boxBottom = extraGap > 0 ? BOX_BOTTOM_LIMIT : bottom;
  tallyRect(doc, LEFT, boxTop, FULL_W, boxBottom - boxTop);
}

/** Measure the natural body bottom y by laying it out on a throwaway document
 * with identical fonts (no visible output is produced). */
function measureBodyBottom(dto: InvoiceRenderDTO, boxTop: number): number {
  const probe = new PDFDocument({ size: 'A4', margins: { top: INV_MARGIN, bottom: INV_MARGIN, left: INV_MARGIN, right: INV_MARGIN } });
  probe.on('data', () => {});
  probe.on('error', () => {});
  setActiveTallyFonts(registerTallyFonts(probe));
  const bottom = layoutBody(probe, dto, boxTop, 0);
  probe.end();
  return bottom;
}

/** Compose a party's display lines (address, GSTIN, state) as plain strings. */
function partyLines(party: RenderParty): { name: string; lines: string[] } {
  const lines = [...party.address_lines];
  if (party.gstin) lines.push(`GSTIN/UIN : ${party.gstin}`);
  if (party.state) lines.push(`State Name : ${party.state}`);
  return { name: party.name, lines };
}

/** Measure the height a party block (heading + name + lines) needs in width w. */
function partyBlockHeight(
  doc: Doc,
  heading: string | null,
  party: RenderParty,
  w: number,
): number {
  const { name, lines } = partyLines(party);
  let h = TALLY.padY;
  if (heading) h += lineH(doc, heading, w, { size: TALLY.size.small });
  h += lineH(doc, name, w, { bold: true, size: TALLY.size.name });
  for (const l of lines) h += lineH(doc, l, w, { size: TALLY.size.small });
  return h + TALLY.padY;
}

type Doc = InstanceType<typeof PDFDocument>;

/** Height of a single wrapped string (no extra cell padding). */
function lineH(
  doc: Doc,
  text: string,
  w: number,
  opts: { bold?: boolean; size?: number } = {},
): number {
  return doc
    .font(tallyFont(opts.bold, false))
    .fontSize(opts.size ?? TALLY.size.small)
    .heightOfString(text || ' ', { width: w - TALLY.padX * 2, lineGap: 0.5 });
}

/** Draw a party block (optional heading, bold name, detail lines) at x,y. */
function drawPartyBlock(
  doc: Doc,
  heading: string | null,
  party: RenderParty,
  x: number,
  y: number,
  w: number,
): number {
  let cy = y + TALLY.padY;
  if (heading) {
    tallyText(doc, heading, x, cy, w, { size: TALLY.size.small, padTop: 0 });
    cy = doc.y;
  }
  tallyText(doc, party.name, x, cy, w, { bold: true, size: TALLY.size.name, padTop: 0 });
  cy = doc.y;
  const { lines } = partyLines(party);
  for (const l of lines) {
    tallyText(doc, l, x, cy, w, { size: TALLY.size.small, padTop: 0 });
    cy = doc.y;
  }
  return cy + TALLY.padY;
}

/**
 * Top block: left column stacks Seller / Consignee / Buyer; right column is the
 * metadata grid (Invoice No., Dated, references …). The block height is the max
 * of the two columns; borders frame every cell.
 */
function drawTopBlock(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  // --- Left column: seller, consignee, buyer stacked with dividers. ---
  const sellerH = partyBlockHeight(doc, null, dto.company, LEFT_W);
  const shipH = partyBlockHeight(doc, 'Consignee (Ship to)', dto.ship_to, LEFT_W);
  const billH = partyBlockHeight(doc, 'Buyer (Bill to)', dto.bill_to, LEFT_W);

  // --- Right column: metadata pairs laid out as a 2-col grid of boxed cells. ---
  const meta = buildMetadata(dto);
  const metaRowH = 25;
  const metaH = Math.ceil(meta.length / 2) * metaRowH;

  const leftColH = sellerH + shipH + billH;
  const blockH = Math.max(leftColH, metaH);

  // Left column cells.
  let ly = top;
  drawPartyBlock(doc, null, dto.company, LEFT, ly, LEFT_W);
  ly += sellerH;
  tallyLine(doc, LEFT, ly, SPLIT, ly);
  drawPartyBlock(doc, 'Consignee (Ship to)', dto.ship_to, LEFT, ly, LEFT_W);
  ly += shipH;
  tallyLine(doc, LEFT, ly, SPLIT, ly);
  drawPartyBlock(doc, 'Buyer (Bill to)', dto.bill_to, LEFT, ly, LEFT_W);

  // Right column metadata grid.
  drawMetadataGrid(doc, meta, SPLIT, top, RIGHT_W, blockH, metaRowH);

  // Vertical divider between the two columns and the block's bottom border.
  const bottom = top + blockH;
  tallyLine(doc, SPLIT, top, SPLIT, bottom);
  tallyLine(doc, LEFT, bottom, RIGHT, bottom);
  return bottom;
}

/** Build the ordered (label, value) metadata pairs from the DTO. */
function buildMetadata(dto: InvoiceRenderDTO): Array<[string, string]> {
  const refMap = new Map(dto.references.map((r) => [r.label, r.value]));
  const take = (label: string) => refMap.get(label) ?? '';
  // Paired to mirror the reference's two-column metadata grid. Each pair is one
  // grid row (left cell, right cell). Empty values still render their label so
  // the grid keeps its familiar shape (this is the classic Tally header).
  return [
    ['Invoice No.', dto.invoice_number],
    ['Dated', dto.invoice_date],
    ['Delivery Note', take('Delivery Note')],
    ['Mode/Terms of Payment', dto.payment_terms || dto.payment_mode],
    ['Reference No. & Date.', joinRef(take('Reference No.'), take('Reference Date'))],
    ['Other References', take('Other References')],
    ["Buyer's Order No.", take("Buyer's Order No.")],
    ['Dated', take('Order Date')],
    ['Dispatch Doc No.', take('Dispatch Doc No.')],
    ['Delivery Note Date', take('Dispatch Date')],
    ['Dispatched through', take('Dispatched Through')],
    ['Destination', take('Destination')],
    ['Terms of Delivery', take('Terms of Delivery')],
    ['', ''],
  ];
}

function joinRef(a: string, b: string): string {
  return [a, b].filter(Boolean).join(' ');
}

/**
 * Draw the metadata as a 2-column grid of boxed label/value cells. Each cell
 * shows a small label with the value in bold beneath it (Tally style). The
 * grid fills the block height so its bottom aligns with the left column.
 */
function drawMetadataGrid(
  doc: Doc,
  meta: Array<[string, string]>,
  x: number,
  top: number,
  w: number,
  blockH: number,
  rowH: number,
): void {
  const colW = w / 2;
  const rows = Math.ceil(meta.length / 2);
  // Distribute any extra height into the last row so the grid reaches blockH.
  const usedH = rows * rowH;
  const lastExtra = Math.max(0, blockH - usedH);

  for (let r = 0; r < rows; r++) {
    const isLast = r === rows - 1;
    const h = rowH + (isLast ? lastExtra : 0);
    const cy = top + r * rowH;
    for (let c = 0; c < 2; c++) {
      const idx = r * 2 + c;
      if (idx >= meta.length) continue;
      const [label, value] = meta[idx];
      const cx = x + c * colW;
      if (label) {
        tallyText(doc, label, cx, cy, colW, { size: TALLY.size.small, padTop: 4 });
        if (value) {
          tallyText(doc, value, cx, cy + 12, colW, {
            bold: true,
            size: TALLY.size.body,
            padTop: 0,
          });
        }
      }
      // Vertical divider between the two metadata columns.
      if (c === 1) tallyLine(doc, cx, cy, cx, cy + h);
    }
    // Horizontal divider below each metadata row (except the block bottom).
    if (!isLast) tallyLine(doc, x, cy + rowH, x + w, cy + rowH);
  }
}

/** Column header row for the line-item table. */
function drawItemsHeader(doc: Doc, top: number): number {
  const h = 24;
  const midY = top + 4;
  const head = (text: string, x: number, w: number, align: 'left' | 'center' | 'right') =>
    tallyText(doc, text, x, midY, w, { bold: true, size: TALLY.size.small, align, padTop: 0 });
  head('Sl\nNo.', IC.x0, IC.sl, 'center');
  head('Description of\nServices', IC.xDesc, IC.desc, 'center');
  head('HSN/SAC', IC.xHsn, IC.hsn, 'center');
  head('Quantity', IC.xQty, IC.qty, 'center');
  head('Rate', IC.xRate, IC.rate, 'center');
  head('per', IC.xPer, IC.per, 'center');
  head('Disc. %', IC.xDisc, IC.disc, 'center');
  head('Amount', IC.xAmount, IC.amount, 'center');
  const bottom = top + h;
  drawItemColumnDividers(doc, top, bottom);
  tallyLine(doc, LEFT, bottom, RIGHT, bottom);
  return bottom;
}

/** Vertical dividers separating the line-item columns, top→bottom. */
function drawItemColumnDividers(doc: Doc, top: number, bottom: number): void {
  for (const x of [IC.xDesc, IC.xHsn, IC.xQty, IC.xRate, IC.xPer, IC.xDisc, IC.xAmount]) {
    tallyLine(doc, x, top, x, bottom);
  }
}

/**
 * Draw the line items, then the in-area tax lines (CGST/SGST or IGST) and
 * round-off aligned to the amount column — exactly as Tally shows them inside
 * the item table. Returns the y at the bottom of the item area.
 */
function drawItems(doc: Doc, dto: InvoiceRenderDTO, top: number, extraGap = 0): number {
  let y = top;
  for (const line of dto.lines) {
    // Primary description line (bold): the operation/service name. Secondary
    // lines (italic, indented under it): job/mould ref, description, spec.
    const primary = line.operation || line.description || line.job_or_mould || '—';
    const secondary = [line.job_or_mould, line.description, line.specification]
      .filter(Boolean)
      .filter((s) => s !== primary)
      .join('\n');

    const primaryH = tallyTextHeight(doc, primary, IC.desc, { bold: true, size: TALLY.size.body });
    const secondaryH = secondary
      ? tallyTextHeight(doc, secondary, IC.desc, { italic: true, size: TALLY.size.small })
      : 0;
    const rowH = Math.max(18, primaryH + secondaryH);

    tallyText(doc, String(line.serial), IC.x0, y, IC.sl, {
      align: 'center',
      size: TALLY.size.body,
    });
    tallyText(doc, primary, IC.xDesc, y, IC.desc, {
      bold: true,
      size: TALLY.size.body,
      padTop: TALLY.padY,
    });
    if (secondary) {
      tallyText(doc, secondary, IC.xDesc, doc.y, IC.desc, {
        italic: true,
        size: TALLY.size.small,
        padTop: 0,
      });
    }
    tallyText(doc, line.hsn_sac, IC.xHsn, y, IC.hsn, { align: 'center', size: TALLY.size.body });
    tallyText(doc, `${line.quantity} ${line.unit}`.trim(), IC.xQty, y, IC.qty, {
      align: 'right',
      size: TALLY.size.body,
    });
    tallyText(doc, line.rate, IC.xRate, y, IC.rate, { align: 'right', size: TALLY.size.body });
    tallyText(doc, line.unit, IC.xPer, y, IC.per, { align: 'center', size: TALLY.size.body });
    tallyText(doc, discDisplay(line.discount_percent), IC.xDisc, y, IC.disc, {
      align: 'right',
      size: TALLY.size.body,
    });
    tallyText(doc, line.amount, IC.xAmount, y, IC.amount, {
      bold: true,
      align: 'right',
      size: TALLY.size.body,
    });
    y += rowH;
  }

  // In-area tax + round-off lines, aligned to Rate/per/Amount columns.
  // extraGap distributes spare single-page space here so the description area
  // breathes instead of leaving one blank block at the bottom (Req: leave
  // space after the services when room allows).
  y += 6 + Math.max(0, extraGap);
  const taxLine = (label: string, rate: string, amount: string) => {
    tallyText(doc, label, IC.xDesc, y, IC.desc, {
      bold: true,
      italic: true,
      align: 'right',
      size: TALLY.size.body,
    });
    if (rate) {
      tallyText(doc, rate, IC.xRate, y, IC.rate, { align: 'right', size: TALLY.size.body });
      tallyText(doc, '%', IC.xPer, y, IC.per, { align: 'center', size: TALLY.size.body });
    }
    tallyText(doc, amount, IC.xAmount, y, IC.amount, {
      bold: true,
      align: 'right',
      size: TALLY.size.body,
    });
    y += 13;
  };

  const firstTax = dto.tax_summary[0];
  if (dto.is_intra_state) {
    taxLine(
      `Output CGST@${trimRate(firstTax?.cgst_rate)}%`,
      trimRate(firstTax?.cgst_rate),
      dto.totals.cgst,
    );
    taxLine(
      `Output SGST@${trimRate(firstTax?.sgst_rate)}%`,
      trimRate(firstTax?.sgst_rate),
      dto.totals.sgst,
    );
  } else {
    taxLine(
      `Output IGST@${trimRate(firstTax?.igst_rate)}%`,
      trimRate(firstTax?.igst_rate),
      dto.totals.igst,
    );
  }
  if (dto.totals.round_off && !/^-?0\.00$/.test(dto.totals.round_off)) {
    tallyText(doc, 'Less : Round Off', IC.xDesc, y, IC.desc, {
      italic: true,
      align: 'right',
      size: TALLY.size.body,
    });
    tallyText(doc, roundOffDisplay(dto.totals.round_off), IC.xAmount, y, IC.amount, {
      bold: true,
      align: 'right',
      size: TALLY.size.body,
    });
    y += 13;
  }

  y += 4;
  drawItemColumnDividers(doc, top, y);
  tallyLine(doc, LEFT, y, RIGHT, y);
  return y;
}

/** Total row: total quantity (under Quantity) and the grand total (₹). */
function drawTotalRow(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  const h = 20;
  const bottom = top + h;
  tallyText(doc, 'Total', IC.xDesc, top + 5, IC.desc, {
    bold: true,
    align: 'right',
    size: TALLY.size.body,
    padTop: 0,
  });
  const totalQty = sumQuantities(dto);
  if (totalQty) {
    tallyText(doc, totalQty, IC.xQty, top + 5, IC.qty, {
      bold: true,
      align: 'right',
      size: TALLY.size.body,
      padTop: 0,
    });
  }
  const currency = tallyHasRupee() ? '\u20b9' : 'INR';
  tallyText(doc, `${currency} ${dto.totals.grand_total}`, IC.xAmount, top + 4, IC.amount, {
    bold: true,
    align: 'right',
    size: TALLY.size.grand,
    padTop: 0,
  });
  drawItemColumnDividers(doc, top, bottom);
  tallyLine(doc, LEFT, bottom, RIGHT, bottom);
  return bottom;
}

/** "Amount Chargeable (in words)" cell with E.&O.E on the right. */
function drawAmountInWords(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  let cy = top + TALLY.padY;
  tallyText(doc, 'Amount Chargeable (in words)', LEFT, cy, FULL_W - 60, {
    size: TALLY.size.small,
    padTop: 0,
  });
  tallyText(doc, 'E. & O.E', RIGHT - 60, top + TALLY.padY, 60 - TALLY.padX, {
    align: 'right',
    size: TALLY.size.small,
    padTop: 0,
  });
  cy = doc.y;
  tallyText(doc, dto.grand_total_words, LEFT, cy, FULL_W, {
    bold: true,
    size: TALLY.size.body,
    padTop: 0,
  });
  const bottom = doc.y + TALLY.padY;
  tallyLine(doc, LEFT, bottom, RIGHT, bottom);
  return bottom;
}

/** Compact GST summary table (HSN/SAC | Taxable | CGST r/amt | SGST r/amt | Total tax). */
function drawTaxSummary(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  const intra = dto.is_intra_state;
  // Column layout for the summary grid.
  const hsnW = 120;
  const taxableW = 90;
  const totalW = 90;
  const midW = FULL_W - hsnW - taxableW - totalW;
  const rateW = midW * (intra ? 0.25 : 0.5);
  const amtW = midW * (intra ? 0.25 : 0.5);

  const xHsn = LEFT;
  const xTaxable = xHsn + hsnW;
  const xCgstRate = xTaxable + taxableW;
  const xCgstAmt = xCgstRate + rateW;
  const xSgstRate = intra ? xCgstAmt + amtW : xCgstAmt;
  const xSgstAmt = xSgstRate + rateW;
  const xTotal = RIGHT - totalW;

  // Header: a thin CGST / SGST group-label row (h1) sits above the main
  // Rate/Amount header row (h2). Only the CGST and SGST/UTGST group labels live
  // in the small top row; every other header cell (HSN/SAC, Taxable Value,
  // Total Tax Amount) spans the full header height as before.
  const hRow1 = top;
  const h1 = 10; // thin group-label row (CGST / SGST only)
  const h2 = 14; // main header row (Rate / Amount)
  const headBottom = top + h1 + h2;
  const groupSep = top + h1; // divider under the thin group-label row
  // Full-height header cells are vertically centred across h1 + h2.
  const fullMid = hRow1 + (h1 + h2) / 2 - 6;
  tallyText(doc, 'HSN/SAC', xHsn, fullMid + 2, hsnW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
  tallyText(doc, 'Taxable\nValue', xTaxable, fullMid, taxableW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
  tallyText(doc, 'Total\nTax Amount', xTotal, fullMid, totalW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
  if (intra) {
    // Thin group-label row.
    tallyText(doc, 'CGST', xCgstRate, hRow1 + 1, rateW + amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'SGST/UTGST', xSgstRate, hRow1 + 1, rateW + amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    // Main header row (Rate / Amount under each group).
    tallyText(doc, 'Rate', xCgstRate, groupSep + 2, rateW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'Amount', xCgstAmt, groupSep + 2, amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'Rate', xSgstRate, groupSep + 2, rateW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'Amount', xSgstAmt, groupSep + 2, amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    // Divider under the thin group-label row, only across the CGST+SGST span
    // (keeps HSN / Taxable / Total cells full-height and uninterrupted).
    tallyLine(doc, xCgstRate, groupSep, xTotal, groupSep);
  } else {
    tallyText(doc, 'IGST', xCgstRate, hRow1 + 1, rateW + amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'Rate', xCgstRate, groupSep + 2, rateW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, 'Amount', xCgstAmt, groupSep + 2, amtW, { bold: true, align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyLine(doc, xCgstRate, groupSep, xTotal, groupSep);
  }
  tallyLine(doc, LEFT, headBottom, RIGHT, headBottom);

  // Data rows.
  let y = headBottom;
  const rowH = 13;
  for (const row of dto.tax_summary) {
    tallyText(doc, row.hsn_sac, xHsn, y + 1, hsnW, { align: 'center', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, row.taxable_value, xTaxable, y + 1, taxableW, { align: 'right', size: TALLY.size.small, padTop: 0 });
    if (intra) {
      tallyText(doc, `${trimRate(row.cgst_rate)}%`, xCgstRate, y + 1, rateW, { align: 'center', size: TALLY.size.small, padTop: 0 });
      tallyText(doc, row.cgst_amount, xCgstAmt, y + 1, amtW, { align: 'right', size: TALLY.size.small, padTop: 0 });
      tallyText(doc, `${trimRate(row.sgst_rate)}%`, xSgstRate, y + 1, rateW, { align: 'center', size: TALLY.size.small, padTop: 0 });
      tallyText(doc, row.sgst_amount, xSgstAmt, y + 1, amtW, { align: 'right', size: TALLY.size.small, padTop: 0 });
    } else {
      tallyText(doc, `${trimRate(row.igst_rate)}%`, xCgstRate, y + 1, rateW, { align: 'center', size: TALLY.size.small, padTop: 0 });
      tallyText(doc, row.igst_amount, xCgstAmt, y + 1, amtW, { align: 'right', size: TALLY.size.small, padTop: 0 });
    }
    tallyText(doc, row.total_tax, xTotal, y + 1, totalW, { align: 'right', size: TALLY.size.small, padTop: 0 });
    y += rowH;
  }
  // Total row.
  tallyText(doc, 'Total', xHsn, y + 1, hsnW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
  tallyText(doc, dto.totals.taxable, xTaxable, y + 1, taxableW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
  if (intra) {
    tallyText(doc, dto.totals.cgst, xCgstAmt, y + 1, amtW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
    tallyText(doc, dto.totals.sgst, xSgstAmt, y + 1, amtW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
  } else {
    tallyText(doc, dto.totals.igst, xCgstAmt, y + 1, amtW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
  }
  tallyText(doc, sumTax(dto), xTotal, y + 1, totalW, { bold: true, align: 'right', size: TALLY.size.small, padTop: 0 });
  y += rowH;

  // Full-height vertical dividers: group boundaries run the whole summary.
  const fullDividers = intra
    ? [xTaxable, xCgstRate, xSgstRate, xTotal]
    : [xTaxable, xCgstRate, xTotal];
  for (const x of fullDividers) tallyLine(doc, x, top, x, y);
  // Rate|Amount dividers sit only below the thin group-label row so the CGST /
  // SGST labels stay uninterrupted above them.
  const innerDividers = intra ? [xCgstAmt, xSgstAmt] : [xCgstAmt];
  for (const x of innerDividers) tallyLine(doc, x, groupSep, x, y);
  tallyLine(doc, LEFT, y, RIGHT, y);
  return y;
}

/** "Tax Amount (in words) : …" cell. */
function drawTaxInWords(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  tallyText(doc, `Tax Amount (in words) : ${dto.tax_amount_words}`, LEFT, top, FULL_W, {
    size: TALLY.size.small,
  });
  const bottom = doc.y + TALLY.padY;
  tallyLine(doc, LEFT, bottom, RIGHT, bottom);
  return bottom;
}

/**
 * Footer block: declaration (left) and bank details + "for <Company>" /
 * Authorised Signatory (right), separated by a vertical divider.
 */
function drawFooterBlock(doc: Doc, dto: InvoiceRenderDTO, top: number): number {
  const declaration =
    dto.declaration ||
    'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.';

  // Right column: bank details + signatory.
  const bankLines: string[] = [];
  if (dto.bank.bank_name) bankLines.push(`Bank Name : ${dto.bank.bank_name}`);
  if (dto.bank.account_number) bankLines.push(`A/c No. : ${dto.bank.account_number}`);
  if (dto.bank.branch || dto.bank.ifsc) {
    bankLines.push(`Branch & IFS Code : ${[dto.bank.branch, dto.bank.ifsc].filter(Boolean).join(' & ')}`);
  }
  if (dto.upi_id) bankLines.push(`UPI : ${dto.upi_id}`);

  // Measure both columns to size the block.
  let ry = top + TALLY.padY;
  ry += lineH(doc, "Company's Bank Details", RIGHT_W, { bold: true, size: TALLY.size.small });
  for (const l of bankLines) ry += lineH(doc, l, RIGHT_W, { size: TALLY.size.small });
  ry += 6;
  ry += lineH(doc, `for ${dto.company.name}`, RIGHT_W, { bold: true, size: TALLY.size.small });
  ry += 22; // signatory space
  ry += lineH(doc, 'Authorised Signatory', RIGHT_W, { size: TALLY.size.small });
  const rightH = ry - top + TALLY.padY;

  let dy = top + TALLY.padY;
  dy += lineH(doc, 'Declaration', LEFT_W, { bold: true, size: TALLY.size.small });
  dy += lineH(doc, declaration, LEFT_W, { size: TALLY.size.small });
  const leftH = dy - top + TALLY.padY;

  const blockH = Math.max(rightH, leftH, 70);
  const bottom = top + blockH;

  // Left: declaration.
  let cy = top + TALLY.padY;
  tallyText(doc, 'Declaration', LEFT, cy, LEFT_W, { bold: true, size: TALLY.size.small, padTop: 0 });
  cy = doc.y;
  tallyText(doc, declaration, LEFT, cy, LEFT_W, { size: TALLY.size.small, padTop: 0 });

  // Right: bank details.
  cy = top + TALLY.padY;
  tallyText(doc, "Company's Bank Details", SPLIT, cy, RIGHT_W, {
    bold: true,
    size: TALLY.size.small,
    padTop: 0,
  });
  cy = doc.y;
  for (const l of bankLines) {
    tallyText(doc, l, SPLIT, cy, RIGHT_W, { size: TALLY.size.small, padTop: 0 });
    cy = doc.y;
  }
  // "for <Company>" and Authorised Signatory at the block bottom-right.
  tallyText(doc, `for ${dto.company.name}`, SPLIT, bottom - 30, RIGHT_W, {
    bold: true,
    align: 'right',
    size: TALLY.size.small,
    padTop: 0,
  });
  if (dto.authorized_signatory) {
    tallyText(doc, dto.authorized_signatory, SPLIT, bottom - 20, RIGHT_W, {
      align: 'right',
      size: TALLY.size.small,
      padTop: 0,
    });
  }
  tallyText(doc, 'Authorised Signatory', SPLIT, bottom - 11, RIGHT_W, {
    align: 'right',
    size: TALLY.size.small,
    padTop: 0,
  });

  tallyLine(doc, SPLIT, top, SPLIT, bottom);

  // Copy marker (presentation-only) stamped top-right of the footer band.
  if (dto.copy_label) {
    doc
      .font(tallyFont(true, false))
      .fontSize(TALLY.size.copy)
      .fillColor(TALLY.ink)
      .text(`(${dto.copy_label})`, SPLIT + TALLY.padX, top - 12, {
        width: RIGHT_W - TALLY.padX * 2,
        align: 'right',
        lineBreak: false,
      });
  }
  return bottom;
}

// --- small display helpers (formatting only; never recalculation) ---

/** Trim a rate like "9.00" → "9", "18.50" → "18.5". */
function trimRate(rate?: string): string {
  if (!rate) return '';
  return rate.replace(/\.00$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** Disc.% cell: blank for zero discount (Tally leaves it empty). */
function discDisplay(disc: string): string {
  if (!disc || /^0(\.0+)?$/.test(disc)) return '';
  return trimRate(disc);
}

/** Round-off shown Tally-style: "(-)0.40" for negative, "0.24" for positive. */
function roundOffDisplay(value: string): string {
  if (value.startsWith('-')) return `(-)${value.slice(1)}`;
  return value;
}

/** Sum line quantities for the Total row (display only; strings already formatted). */
function sumQuantities(dto: InvoiceRenderDTO): string {
  // Only meaningful when all lines share a unit; otherwise omit (matches Tally
  // which shows a combined figure only for like units). The engine does not
  // provide a total quantity, so we sum the already-formatted display values
  // conservatively and only when every unit matches.
  const units = new Set(dto.lines.map((l) => l.unit).filter(Boolean));
  if (dto.lines.length === 0 || units.size !== 1) return '';
  let sum = 0;
  for (const l of dto.lines) {
    const n = Number(l.quantity.replace(/,/g, ''));
    if (!Number.isFinite(n)) return '';
    sum += n;
  }
  const unit = [...units][0];
  return `${sum} ${unit}`.trim();
}

/** Total tax amount for the GST summary total row (display sum of formatted values). */
function sumTax(dto: InvoiceRenderDTO): string {
  // Sum the preformatted total_tax strings from the summary rows. These are
  // display strings produced by the engine; we only re-group for display.
  let sum = 0;
  for (const r of dto.tax_summary) {
    const n = Number(r.total_tax.replace(/,/g, ''));
    if (!Number.isFinite(n)) return dto.tax_summary[0]?.total_tax ?? '';
    sum += n;
  }
  return groupIndian(sum);
}

/** Indian digit grouping with 2 dp (mirrors formatMoney for a display sum). */
function groupIndian(amount: number): string {
  const neg = amount < 0;
  const [whole, frac] = Math.abs(amount).toFixed(2).split('.');
  let head = whole;
  let tail = '';
  if (head.length > 3) {
    tail = head.slice(-3);
    head = head.slice(0, -3);
    const parts: string[] = [];
    while (head.length > 2) {
      parts.unshift(head.slice(-2));
      head = head.slice(0, -2);
    }
    parts.unshift(head);
    head = parts.join(',') + ',' + tail;
  }
  const result = `${head}.${frac}`;
  return neg ? `-${result}` : result;
}
