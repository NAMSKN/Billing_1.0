import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Challan } from '@shared/domain/challan';
import { buildChallanRenderDto } from './challanRenderDto';
import { renderChallanPdf } from './challanRenderer';

/**
 * Resolves a finalized challan's snapshot into an immutable render DTO and hands
 * it to the ReportLab-style pdfkit renderer. The renderer never touches the DB
 * or recalculates (D-011). Export writes atomically (temp file + rename).
 */
export class ChallanPdfService {
  /** Render a finalized challan to PDF bytes. */
  async render(challan: Challan): Promise<Buffer> {
    return renderChallanPdf(buildChallanRenderDto(challan));
  }

  /** Render and write the PDF to `outputPath` atomically. Returns the path. */
  async export(challan: Challan, outputPath: string): Promise<string> {
    const pdf = await this.render(challan);
    await mkdir(dirname(outputPath), { recursive: true });
    const tmp = `${outputPath}.tmp`;
    await writeFile(tmp, pdf);
    await rename(tmp, outputPath);
    return outputPath;
  }

  /** Deterministic export filename: DC/26-27/003 -> DC_DC_26-27_003.pdf. */
  static exportFilename(challanNumber: string): string {
    const safe = challanNumber.replace(/[/\\]/g, '_');
    return `CHALLAN_${safe}.pdf`;
  }

  static defaultExportPath(exportsDir: string, challanNumber: string): string {
    return join(exportsDir, ChallanPdfService.exportFilename(challanNumber));
  }
}
