/**
 * GSTR-3B Computation and JSON Generation.
 * Matches GSTN Offline Tool Schema v1.7.
 */

import { round2 } from './gstr1';

export interface Gstr3bSupplyDetail {
  txval: number;
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr3bItcDetail {
  iamt: number;
  camt: number;
  samt: number;
  csamt: number;
}

export interface Gstr3bPayload {
  gstin: string;
  ret_period: string; // MMYYYY e.g. "082026"
  sup_details: {
    osup_det: Gstr3bSupplyDetail; // 3.1(a) Outward taxable
    osup_zero: Gstr3bSupplyDetail; // 3.1(b) Zero rated
    osup_nil_exmp: { txval: number }; // 3.1(c) Nil / Exempt
    isup_rev: Gstr3bSupplyDetail; // 3.1(d) Inward reverse charge
    osup_nongst: { txval: number }; // 3.1(e) Non-GST
  };
  itc_elg: {
    itc_avl: Array<{
      ty: 'IMPG' | 'IMPS' | 'ISRC' | 'ISD' | 'OTH';
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }>;
    itc_rev: Array<{
      ty: 'RUL' | 'OTH';
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }>;
    itc_net: Gstr3bItcDetail;
    itc_inelg: Array<{
      ty: 'RUL' | 'OTH';
      iamt: number;
      camt: number;
      samt: number;
      csamt: number;
    }>;
  };
  inward_sup?: {
    isup_details: Array<{
      ty: 'GST' | 'NONGST';
      inter: number;
      intra: number;
    }>;
  };
}

/**
 * Builds GSTR-3B JSON object ready for direct upload to gst.gov.in.
 */
export function buildGstr3bPayload(params: {
  gstin: string;
  ret_period: string; // MMYYYY
  outwardTaxable: Gstr3bSupplyDetail;
  zeroRated?: Partial<Gstr3bSupplyDetail>;
  nilExemptTaxable?: number;
  inwardReverseCharge?: Partial<Gstr3bSupplyDetail>;
  itcOther?: Partial<Gstr3bItcDetail>;
  itcReverseCharge?: Partial<Gstr3bItcDetail>;
}): Gstr3bPayload {
  const zero: Gstr3bSupplyDetail = {
    txval: round2(params.zeroRated?.txval || 0),
    iamt: round2(params.zeroRated?.iamt || 0),
    camt: 0,
    samt: 0,
    csamt: round2(params.zeroRated?.csamt || 0),
  };

  const isupRev: Gstr3bSupplyDetail = {
    txval: round2(params.inwardReverseCharge?.txval || 0),
    iamt: round2(params.inwardReverseCharge?.iamt || 0),
    camt: round2(params.inwardReverseCharge?.camt || 0),
    samt: round2(params.inwardReverseCharge?.samt || 0),
    csamt: round2(params.inwardReverseCharge?.csamt || 0),
  };

  const itcOth: Gstr3bItcDetail = {
    iamt: round2(params.itcOther?.iamt || 0),
    camt: round2(params.itcOther?.camt || 0),
    samt: round2(params.itcOther?.samt || 0),
    csamt: round2(params.itcOther?.csamt || 0),
  };

  const itcRev: Gstr3bItcDetail = {
    iamt: round2(params.itcReverseCharge?.iamt || 0),
    camt: round2(params.itcReverseCharge?.camt || 0),
    samt: round2(params.itcReverseCharge?.samt || 0),
    csamt: round2(params.itcReverseCharge?.csamt || 0),
  };

  const netItc: Gstr3bItcDetail = {
    iamt: round2(itcOth.iamt + itcRev.iamt),
    camt: round2(itcOth.camt + itcRev.camt),
    samt: round2(itcOth.samt + itcRev.samt),
    csamt: round2(itcOth.csamt + itcRev.csamt),
  };

  return {
    gstin: params.gstin,
    ret_period: params.ret_period,
    sup_details: {
      osup_det: {
        txval: round2(params.outwardTaxable.txval),
        iamt: round2(params.outwardTaxable.iamt),
        camt: round2(params.outwardTaxable.camt),
        samt: round2(params.outwardTaxable.samt),
        csamt: round2(params.outwardTaxable.csamt),
      },
      osup_zero: zero,
      osup_nil_exmp: { txval: round2(params.nilExemptTaxable || 0) },
      isup_rev: isupRev,
      osup_nongst: { txval: 0 },
    },
    itc_elg: {
      itc_avl: [
        { ty: 'IMPG', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'IMPS', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'ISRC', ...itcRev },
        { ty: 'ISD', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', ...itcOth },
      ],
      itc_rev: [
        { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ],
      itc_net: netItc,
      itc_inelg: [
        { ty: 'RUL', iamt: 0, camt: 0, samt: 0, csamt: 0 },
        { ty: 'OTH', iamt: 0, camt: 0, samt: 0, csamt: 0 },
      ],
    },
  };
}
