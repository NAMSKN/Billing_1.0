import { Money } from '@shared/domain/money';
import { TaxTreatment } from '@shared/domain/enums';
import {
  calculateInvoiceTotals,
  calculateLine,
  calculateLineTax,
  buildTaxSummary,
  determineTaxType,
  type TaxLineInput,
} from '@shared/domain/calculation';
import { amountInWords } from '@shared/domain/amountWords';
import type { CalcPreviewRequest, CalcPreviewResponse } from '@shared/dto';
import { taxConfigFromDto } from './dtoMappers';

/**
 * Pure calculation preview for live UI totals. No persistence; the same engine
 * finalization uses, so the preview matches the finalized result exactly. This
 * keeps ALL money math in the engine (the renderer never computes tax).
 */
export function computePreview(req: CalcPreviewRequest): CalcPreviewResponse {
  const config = taxConfigFromDto(req.taxConfig);
  const taxType = determineTaxType(req.companyStateCode, req.placeOfSupplyStateCode);

  const inputs: TaxLineInput[] = [];
  const lineResults: CalcPreviewResponse['lines'] = [];

  for (const line of req.lines) {
    const amounts = calculateLine(
      new Money(line.quantity || '0'),
      new Money(line.rate || '0'),
      new Money(line.discount_percent || '0'),
    );
    const tax = calculateLineTax(amounts.taxable, taxType, config);
    inputs.push({
      hsn_sac: line.hsn_sac,
      tax_treatment: TaxTreatment.TAXABLE,
      tax_type: taxType,
      tax_rate: config.total_rate,
      taxable: amounts.taxable,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst,
    });
    lineResults.push({
      gross: amounts.gross.toFixed(2),
      discount: amounts.discount.toFixed(2),
      taxable: amounts.taxable.toFixed(2),
      cgst: tax.cgst.toFixed(2),
      sgst: tax.sgst.toFixed(2),
      igst: tax.igst.toFixed(2),
      amount: amounts.taxable.plus(tax.cgst).plus(tax.sgst).plus(tax.igst).toFixed(2),
    });
  }

  const totals = calculateInvoiceTotals(inputs);
  const summary = buildTaxSummary(inputs);

  return {
    tax_type: taxType,
    lines: lineResults,
    totals: {
      total_taxable: totals.total_taxable.toFixed(2),
      total_cgst: totals.total_cgst.toFixed(2),
      total_sgst: totals.total_sgst.toFixed(2),
      total_igst: totals.total_igst.toFixed(2),
      raw_total: totals.raw_total.toFixed(2),
      round_off: totals.round_off.toFixed(2),
      grand_total: totals.grand_total.toFixed(2),
    },
    tax_summary: summary.map((r) => ({
      hsn_sac: r.hsn_sac,
      tax_treatment: r.tax_treatment,
      tax_type: r.tax_type,
      tax_rate: r.tax_rate.toFixed(2),
      taxable_value: r.taxable_value.toFixed(2),
      cgst_amount: r.cgst_amount.toFixed(2),
      sgst_amount: r.sgst_amount.toFixed(2),
      igst_amount: r.igst_amount.toFixed(2),
      total_tax: r.total_tax.toFixed(2),
    })),
    grand_total_words: amountInWords(totals.grand_total),
    tax_amount_words: amountInWords(
      totals.total_cgst.plus(totals.total_sgst).plus(totals.total_igst),
    ),
  };
}
