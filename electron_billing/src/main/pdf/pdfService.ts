import { writeFile, rename, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Invoice } from '@shared/domain/models';
import { buildRenderDto } from './renderDto';
import { renderInvoicePdf } from './renderer';

/**
 * PDF service: single rendering path for preview / print / export so all three
 * produce identical content (DECISIONS D-031: content equivalence, not
 * byte-identical files). The renderer receives a prepared DTO and never touches
 * the DB or recalculates.
 */
export class PdfService {
  /** Render a finalized invoice to PDF bytes. */
  async render(invoice: Invoice): Promise<Buffer> {
    return renderInvoicePdf(buildRenderDto(invoice));
  }

  /**
   * Render and write the PDF to `outputPath` atomically (temp file + rename) so
   * a failure mid-write never leaves a corrupt file and never touches the
   * stored invoice. Returns the written path.
   */
  async export(invoice: Invoice, outputPath: string): Promise<string> {
    const pdf = await this.render(invoice);
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
