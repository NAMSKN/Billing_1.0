import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Order } from '@shared/domain/order';
import { buildOrderRenderDto } from './orderRenderDto';
import { renderOrderPdf } from './orderRenderer';

/**
 * Resolves a confirmed order's snapshot into an immutable render DTO and hands
 * it to the pdfkit renderer. The renderer never touches the DB or recalculates.
 * Export writes atomically (temp file + rename).
 */
export class OrderPdfService {
  /** Render a confirmed order to PDF bytes. */
  async render(order: Order): Promise<Buffer> {
    return renderOrderPdf(buildOrderRenderDto(order));
  }

  /** Render and write the PDF to `outputPath` atomically. Returns the path. */
  async export(order: Order, outputPath: string): Promise<string> {
    const pdf = await this.render(order);
    await mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp`;
    await writeFile(tmp, pdf);
    await rename(tmp, outputPath);
    return outputPath;
  }

  /** Deterministic export filename: SO/26-27/003 -> ORDER_SO_26-27_003.pdf. */
  static exportFilename(orderNumber: string): string {
    const safe = orderNumber.replace(/[/\\]/g, '_');
    return `ORDER_${safe}.pdf`;
  }

  static defaultExportPath(exportsDir: string, orderNumber: string): string {
    return join(exportsDir, OrderPdfService.exportFilename(orderNumber));
  }
}
