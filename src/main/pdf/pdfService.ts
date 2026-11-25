import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Invoice } from '@shared/domain/models';
import {
  INVOICE_COPY_LABEL,
  INVOICE_COPY_ORDER,
  InvoiceCopyType,
} from '@shared/domain/enums';
import { buildRenderDto } from './renderDto';
import { renderInvoicePdf } from './renderer';

/**
 * Copy selection for a rendered invoice PDF. Presentation-only: the choice of
 * copy marker(s) never changes invoice content (DECISIONS D-031).
 *   - a single copy type (Original by default), or
 *   - a list of copy types to print, each on its own labelled page.
 */
export interface CopyOptions {
  copyType?: InvoiceCopyType;
  /** When set, render one labelled page per copy type in this order. */
  copies?: InvoiceCopyType[];
}

/** Resolve CopyOptions to the ordered list of printed copy labels. */
function resolveCopyLabels(opts?: CopyOptions): string[] {
  if (opts?.copies && opts.copies.length > 0) {
    // Preserve canonical Original→Duplicate→Triplicate order, de-duplicated.
    const wanted = new Set(opts.copies);
    return INVOICE_COPY_ORDER.filter((t) => wanted.has(t)).map((t) => INVOICE_COPY_LABEL[t]);
  }
  const type = opts?.copyType ?? InvoiceCopyType.ORIGINAL;
  return [INVOICE_COPY_LABEL[type]];
}

/**
 * PDF service: single rendering path for preview / print / export so all three
 * produce identical content (DECISIONS D-031: content equivalence, not
 * byte-identical files). The renderer receives a prepared DTO and never touches
 * the DB or recalculates.
 */
export class PdfService {
  /** Render a finalized invoice to PDF bytes, with optional copy selection. */
  async render(invoice: Invoice, opts?: CopyOptions): Promise<Buffer> {
    return renderInvoicePdf(buildRenderDto(invoice), resolveCopyLabels(opts));
  }

  /**
   * Render and write the PDF to `outputPath` atomically (temp file + rename) so
   * a failure mid-write never leaves a corrupt file and never touches the
   * stored invoice. Returns the written path.
   */
  async export(invoice: Invoice, outputPath: string, opts?: CopyOptions): Promise<string> {
    const pdf = await this.render(invoice, opts);
    await mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp`;
    await writeFile(tmp, pdf);
    await rename(tmp, outputPath);
    return outputPath;
  }

  /** Deterministic export filename: SE/26-27/043 -> INV_SE_26-27_043.pdf. */
  static exportFilename(invoiceNumber: string): string {
    const safe = invoiceNumber.replace(/[/\\]/g, '_');
    return `INV_${safe}.pdf`;
  }

  static defaultExportPath(exportsDir: string, invoiceNumber: string): string {
    return join(exportsDir, PdfService.exportFilename(invoiceNumber));
  }
}
