import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Payment } from '@shared/domain/payment';
import { buildPaymentRenderDto } from './paymentRenderDto';
import { renderPaymentPdf } from './paymentRenderer';

/**
 * Resolves a finalized voucher's snapshot into an immutable render DTO and
 * hands it to the pdfkit renderer. The renderer never touches the DB or
 * recalculates. Export writes atomically (temp file + rename).
 */
export class PaymentPdfService {
  /** Render a finalized voucher to PDF bytes. */
  async render(payment: Payment): Promise<Buffer> {
    return renderPaymentPdf(buildPaymentRenderDto(payment));
  }

  /** Render and write the PDF to `outputPath` atomically. Returns the path. */
  async export(payment: Payment, outputPath: string): Promise<string> {
    const pdf = await this.render(payment);
    await mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp`;
    await writeFile(tmp, pdf);
    await rename(tmp, outputPath);
    return outputPath;
  }

  /** Deterministic export filename: RCPT/26-27/003 -> VOUCHER_RCPT_26-27_003.pdf. */
  static exportFilename(voucherNumber: string): string {
    const safe = voucherNumber.replace(/[/\\]/g, '_');
    return `VOUCHER_${safe}.pdf`;
  }

  static defaultExportPath(exportsDir: string, voucherNumber: string): string {
    return join(exportsDir, PaymentPdfService.exportFilename(voucherNumber));
  }
}
