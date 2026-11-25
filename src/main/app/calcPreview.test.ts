import { describe, it, expect } from 'vitest';
import { TaxType } from '@shared/domain/enums';
import { computePreview } from './calcPreview';
import type { CalcPreviewRequest } from '@shared/dto';

const STANDARD_18_DTO = {
  total_rate: '18',
  cgst_rate: '9',
  sgst_rate: '9',
  igst_rate: '18',
};

describe('computePreview (live UI totals via the engine)', () => {
  it('matches golden 043 for an intra-state line', () => {
    const req: CalcPreviewRequest = {
      companyStateCode: '29',
      placeOfSupplyStateCode: '29',
      taxConfig: STANDARD_18_DTO,
      lines: [{ hsn_sac: '998898', quantity: '1', rate: '12280', discount_percent: '0' }],
    };
    const res = computePreview(req);
    expect(res.tax_type).toBe(TaxType.INTRA_STATE);
    expect(res.totals.grand_total).toBe('14490.00');
    expect(res.totals.round_off).toBe('-0.40');
    expect(res.totals.total_cgst).toBe('1105.20');
    expect(res.grand_total_words).toBe('INR Fourteen Thousand Four Hundred Ninety Only');
  });

  it('produces IGST for an inter-state place of supply', () => {
    const req: CalcPreviewRequest = {
      companyStateCode: '29',
      placeOfSupplyStateCode: '27',
      taxConfig: STANDARD_18_DTO,
      lines: [{ hsn_sac: '998898', quantity: '1', rate: '12280', discount_percent: '0' }],
    };
    const res = computePreview(req);
    expect(res.tax_type).toBe(TaxType.INTER_STATE);
    expect(res.totals.total_igst).toBe('2210.40');
  });
});
