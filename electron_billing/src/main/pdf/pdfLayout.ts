import type PDFDocument from 'pdfkit';

/**
 * Shared layout primitives for all A4 document renderers (invoice, order,
 * challan). Centralises page geometry, the design system (colours, spacing,
 * type scale), and the low-level drawing helpers so every document has a
 * consistent, modern ERP look and a single, correct footer implementation.
 *
 * Design principles applied here:
 * - Strong hierarchy: a defined type scale and weight/colour roles.
 * - Generous whitespace: named spacing tokens instead of magic numbers.
 * - Subtle separators: hairline rules, no heavy boxes.
 * - Printer-friendly: grayscale ink with a single restrained accent.
 */

export type Doc = InstanceType<typeof PDFDocument>;

// --- Page geometry (A4 portrait, points) ---
export const PAGE = { width: 595.28, height: 841.89 } as const;
/** Comfortable page margin — more breathing room than the old 40pt. */
export const MARGIN = 48;
export const CONTENT_WIDTH = PAGE.width - MARGIN * 2;
/** Reserved band at the bottom for the footer so content never collides. */
export const FOOTER_BAND = 46;
/** Y below which body content must not flow (keeps clear of the footer). */
export const CONTENT_BOTTOM = PAGE.height - MARGIN - FOOTER_BAND;

// --- Colour system (grayscale + one accent) ---
export const COLOR = {
  ink: '#0f172a', // primary text
  body: '#334155', // secondary body text
  muted: '#64748b', // labels, captions
  faint: '#94a3b8', // footer, de-emphasised
  line: '#cbd5e1', // section separators
  hair: '#e2e8f0', // row hairlines
  panel: '#f8fafc', // subtle fills (table header, callouts)
  panelEdge: '#e2e8f0',
  accent: '#4338ca', // headings / grand total
  danger: '#ef4444',
} as const;

// --- Type scale ---
export const FONT = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  italic: 'Helvetica-Oblique',
} as const;

export const SIZE = {
  companyName: 17,
  title: 16,
  section: 9,
  label: 8,
  body: 9,
  small: 8,
  grand: 12,
  footer: 7.5,
} as const;

// --- Spacing tokens (points) ---
export const SP = {
  xs: 3,
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
} as const;

/** Section separator (thin, quiet). */
export function rule(doc: Doc, y: number): void {
  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .lineWidth(0.75)
    .strokeColor(COLOR.line)
    .stroke();
}

/** Row hairline (very light, for table rows). */
export function hairline(doc: Doc, y: number): void {
  doc
    .moveTo(MARGIN, y)
    .lineTo(PAGE.width - MARGIN, y)
    .lineWidth(0.4)
    .strokeColor(COLOR.hair)
    .stroke();
}

/** Small uppercase section/eyebrow label. */
export function eyebrow(doc: Doc, text: string, x: number, y: number, width: number): void {
  doc
    .font(FONT.bold)
    .fontSize(SIZE.label)
    .fillColor(COLOR.muted)
    .text(text.toUpperCase(), x, y, { width, characterSpacing: 0.6 });
}

/**
 * Add a page only if fewer than `needed` points of body space remain before the
 * footer band. Optionally redraw a header (e.g. table head) on the new page.
 * Body content is kept strictly above CONTENT_BOTTOM so the footer never forces
 * an extra page.
 */
export function ensureSpace(doc: Doc, needed: number, onNewPage?: () => void): void {
  if (doc.y + needed > CONTENT_BOTTOM) {
    doc.addPage();
    doc.y = MARGIN;
    if (onNewPage) onNewPage();
  }
}

/**
 * Draw the footer on every already-buffered page.
 *
 * Blank-page fix: this runs in a post-pass over pages that already exist
 * (`bufferedPageRange`), and writes with `lineBreak: false` at a y INSIDE the
 * page body (above the physical edge). pdfkit only auto-adds a page when
 * flowing text crosses the bottom margin; disabling line breaks and staying
 * within bounds guarantees no phantom page is ever appended. A single-page
 * document therefore stays a single page.
 *
 * Footer format: "This is a Computer Generated <docLabel> | Page X of Y".
 */
export function drawFooters(doc: Doc, docLabel: string): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const y = PAGE.height - MARGIN - 20;

  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);

    // Thin separator above the footer line for a finished, framed look.
    doc
      .moveTo(MARGIN, y - SP.sm)
      .lineTo(PAGE.width - MARGIN, y - SP.sm)
      .lineWidth(0.5)
      .strokeColor(COLOR.hair)
      .stroke();

    const text = `This is a Computer Generated ${docLabel}  |  Page ${i + 1} of ${total}`;

    doc
      .font(FONT.regular)
      .fontSize(SIZE.footer)
      .fillColor(COLOR.faint)
      // Single centred line, no wrapping — cannot spill onto a new page.
      .text(text, MARGIN, y, { width: CONTENT_WIDTH, align: 'center', lineBreak: false });
  }
}

/** Diagonal CANCELLED watermark on every buffered page. */
export function drawCancelledWatermark(doc: Doc): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.save();
    doc.rotate(-30, { origin: [PAGE.width / 2, PAGE.height / 2] });
    doc
      .font(FONT.bold)
      .fontSize(92)
      .fillColor(COLOR.danger)
      .opacity(0.12)
      .text('CANCELLED', 0, PAGE.height / 2 - 60, { width: PAGE.width, align: 'center' });
    doc.opacity(1).restore();
  }
}
