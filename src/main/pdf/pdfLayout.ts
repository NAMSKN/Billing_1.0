import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  /** Prominent dispatch details on a delivery challan (mode, vehicle no.). */
  dispatch: 18,
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

// ---------------------------------------------------------------------------
// Tally-style GST invoice primitives.
//
// The invoice renderer uses a traditional, fully-bordered black-and-white
// layout (a classic Tally tax-invoice grid) rather than the modern ERP look
// above. These helpers are additive and self-contained so the order / challan
// / payment renderers keep using the modern primitives unchanged.
// ---------------------------------------------------------------------------

/**
 * Register the bundled rupee-capable fonts (Noto Sans, SIL OFL) on a document
 * and return the family names to use. pdfkit's built-in Helvetica has no ₹
 * (U+20B9) glyph, so the invoice embeds Noto Sans to print the rupee symbol
 * faithfully. If the font files are unavailable (e.g. a stripped test env), we
 * fall back to Helvetica so rendering never fails — only the ₹ glyph is then
 * unavailable. Registration is idempotent per document.
 */
export function registerTallyFonts(doc: Doc): {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
  hasRupee: boolean;
} {
  const fontsDir = join(__dirname, 'fonts');
  const regular = join(fontsDir, 'NotoSans-Regular.ttf');
  const bold = join(fontsDir, 'NotoSans-Bold.ttf');
  try {
    if (existsSync(regular) && existsSync(bold)) {
      doc.registerFont('Tally', regular);
      doc.registerFont('Tally-Bold', bold);
      // Noto Sans ships no separate italic here; reuse regular/bold (Tally
      // invoices use italics only for de-emphasis, so this is acceptable).
      return {
        regular: 'Tally',
        bold: 'Tally-Bold',
        italic: 'Tally',
        boldItalic: 'Tally-Bold',
        hasRupee: true,
      };
    }
  } catch {
    // fall through to Helvetica
  }
  return {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    boldItalic: 'Helvetica-BoldOblique',
    hasRupee: false,
  };
}

/** Tally design tokens: pure black ink, thin uniform borders, compact type. */
export const TALLY = {
  ink: '#000000',
  border: '#000000',
  /** Thin rule everywhere; the outer frame uses BORDER_W too for uniformity. */
  borderW: 0.7,
  font: 'Helvetica',
  fontBold: 'Helvetica-Bold',
  fontItalic: 'Helvetica-Oblique',
  fontBoldItalic: 'Helvetica-BoldOblique',
  size: {
    title: 12, // centred "Tax Invoice" above the box (+1 step)
    body: 9, // default/base cell text (+1 step)
    small: 8.5, // metadata / labels / table body (+1 step)
    name: 10, // company / party names (bold, +1 step)
    grand: 10, // grand total / important values (+1 step)
    copy: 8.5, // copy marker (+1 step)
    footer: 8, // page footer (+1 step)
  },
  /** Inner padding inside a bordered cell (~1.5 mm, per approved diagram). */
  padX: 4,
  padY: 4,
} as const;

/** Stroke a straight line in Tally ink at the standard border weight. */
export function tallyLine(doc: Doc, x1: number, y1: number, x2: number, y2: number): void {
  doc
    .moveTo(x1, y1)
    .lineTo(x2, y2)
    .lineWidth(TALLY.borderW)
    .strokeColor(TALLY.border)
    .stroke();
}

/** Stroke a rectangle (cell / box) in Tally ink at the standard border weight. */
export function tallyRect(doc: Doc, x: number, y: number, w: number, h: number): void {
  doc.lineWidth(TALLY.borderW).strokeColor(TALLY.border).rect(x, y, w, h).stroke();
}

export interface TallyCellOpts {
  bold?: boolean;
  italic?: boolean;
  size?: number;
  align?: 'left' | 'center' | 'right';
  /** Extra left/right inset beyond the standard cell padding. */
  padX?: number;
  /** Vertical offset from the cell top (defaults to TALLY.padY). */
  padTop?: number;
}

export interface TallyFontSet {
  regular: string;
  bold: string;
  italic: string;
  boldItalic: string;
  hasRupee: boolean;
}

/** The active Tally font family for the current render (set per document). */
let activeTallyFonts: TallyFontSet = {
  regular: TALLY.font,
  bold: TALLY.fontBold,
  italic: TALLY.fontItalic,
  boldItalic: TALLY.fontBoldItalic,
  hasRupee: false,
};

/** Set the active Tally font family; call once after registerTallyFonts. */
export function setActiveTallyFonts(fonts: TallyFontSet): void {
  activeTallyFonts = fonts;
}

/** Whether the active font can render the ₹ (U+20B9) glyph. */
export function tallyHasRupee(): boolean {
  return activeTallyFonts.hasRupee;
}

/** Pick the active Tally font for a bold/italic combination. */
export function tallyFont(bold?: boolean, italic?: boolean): string {
  if (bold && italic) return activeTallyFonts.boldItalic;
  if (bold) return activeTallyFonts.bold;
  if (italic) return activeTallyFonts.italic;
  return activeTallyFonts.regular;
}

/**
 * Draw wrapping text inside a cell box at (x, y, w) and return the y at the
 * bottom of the drawn text (not the cell). Text is padded and clipped to the
 * cell width so it never spills across a border.
 */
export function tallyText(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  w: number,
  opts: TallyCellOpts = {},
): number {
  const padX = TALLY.padX + (opts.padX ?? 0);
  const padTop = opts.padTop ?? TALLY.padY;
  doc
    .font(tallyFont(opts.bold, opts.italic))
    .fontSize(opts.size ?? TALLY.size.body)
    .fillColor(TALLY.ink)
    .text(text, x + padX, y + padTop, {
      width: w - padX * 2,
      align: opts.align ?? 'left',
      lineGap: 0.5,
    });
  return doc.y;
}

/** Height a wrapped string needs in a cell of width w (includes padding). */
export function tallyTextHeight(
  doc: Doc,
  text: string,
  w: number,
  opts: TallyCellOpts = {},
): number {
  const padX = TALLY.padX + (opts.padX ?? 0);
  const padTop = opts.padTop ?? TALLY.padY;
  const h = doc
    .font(tallyFont(opts.bold, opts.italic))
    .fontSize(opts.size ?? TALLY.size.body)
    .heightOfString(text || ' ', { width: w - padX * 2, lineGap: 0.5 });
  return h + padTop + TALLY.padY;
}

/** Draw the single centred "Tax Invoice" title above the invoice box. */
export function tallyTitle(
  doc: Doc,
  text: string,
  y: number,
  left: number = MARGIN,
  width: number = CONTENT_WIDTH,
): number {
  doc
    .font(tallyFont(true, false))
    .fontSize(TALLY.size.title)
    .fillColor(TALLY.ink)
    .text(text, left, y, { width, align: 'center' });
  return doc.y;
}

/**
 * Footer for the Tally invoice: a single centred line ("This is a Computer
 * Generated Invoice") on every buffered page, with page numbers when there is
 * more than one page. Mirrors the blank-page-safe approach of drawFooters.
 */
export function drawTallyFooter(
  doc: Doc,
  left: number = MARGIN,
  width: number = CONTENT_WIDTH,
  margin: number = MARGIN,
): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  // Stay INSIDE the bottom margin (like drawFooters): writing at/below the
  // margin can make pdfkit append a phantom page even with lineBreak disabled.
  // Use the caller's margin so a larger invoice margin doesn't push the footer
  // past the document's bottom-margin boundary and spawn a phantom page.
  const y = PAGE.height - margin - 12;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    const text =
      total > 1
        ? `This is a Computer Generated Invoice  |  Page ${i + 1} of ${total}`
        : 'This is a Computer Generated Invoice';
    doc
      .font(tallyFont(false, false))
      .fontSize(TALLY.size.footer)
      .fillColor(TALLY.ink)
      .text(text, left, y, { width, align: 'center', lineBreak: false });
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
