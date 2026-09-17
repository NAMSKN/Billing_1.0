import Decimal from 'decimal.js';
import { Money } from '@shared/domain/money';
import type {
  InvoiceReferences,
  InvoiceSnapshot,
  InvoiceLine,
  TaxRateConfig,
  TaxSummaryRow,
  InvoiceTotals,
} from '@shared/domain/models';
import type { ChallanLine, ChallanSnapshot } from '@shared/domain/challan';
import type { OrderLine, OrderSnapshot } from '@shared/domain/order';

/**
 * JSON (de)serialization for the invoice snapshot and references. Decimal
 * values are serialized as fixed-precision strings so reload never introduces
 * float drift (the snapshot is the authoritative reproduction source, D-010).
 *
 * We serialize Decimals via a reviver/replacer that walks known money/quantity
 * fields; simpler and safer than a generic scheme, and keeps the JSON legible.
 */

// Decimal fields that must round-trip as strings inside a serialized snapshot.
function decToStr(d: Decimal): string {
  return d.toString();
}
function strToDec(s: string): Decimal {
  return new Money(s);
}

function serializeLine(line: InvoiceLine): unknown {
  return {
    ...line,
    quantity: decToStr(line.quantity),
    rate: decToStr(line.rate),
    discount_percent: decToStr(line.discount_percent),
    tax_rate: decToStr(line.tax_rate),
    taxable_amount: line.taxable_amount ? decToStr(line.taxable_amount) : null,
    cgst_amount: line.cgst_amount ? decToStr(line.cgst_amount) : null,
    sgst_amount: line.sgst_amount ? decToStr(line.sgst_amount) : null,
    igst_amount: line.igst_amount ? decToStr(line.igst_amount) : null,
  };
}

function deserializeLine(raw: Record<string, unknown>): InvoiceLine {
  return {
    ...(raw as unknown as InvoiceLine),
    quantity: strToDec(raw.quantity as string),
    rate: strToDec(raw.rate as string),
    discount_percent: strToDec(raw.discount_percent as string),
    tax_rate: strToDec(raw.tax_rate as string),
    taxable_amount: raw.taxable_amount ? strToDec(raw.taxable_amount as string) : null,
    cgst_amount: raw.cgst_amount ? strToDec(raw.cgst_amount as string) : null,
    sgst_amount: raw.sgst_amount ? strToDec(raw.sgst_amount as string) : null,
    igst_amount: raw.igst_amount ? strToDec(raw.igst_amount as string) : null,
  };
}

function serializeConfig(c: TaxRateConfig): unknown {
  return {
    total_rate: decToStr(c.total_rate),
    cgst_rate: decToStr(c.cgst_rate),
    sgst_rate: decToStr(c.sgst_rate),
    igst_rate: decToStr(c.igst_rate),
  };
}
function deserializeConfig(raw: Record<string, unknown>): TaxRateConfig {
  return {
    total_rate: strToDec(raw.total_rate as string),
    cgst_rate: strToDec(raw.cgst_rate as string),
    sgst_rate: strToDec(raw.sgst_rate as string),
    igst_rate: strToDec(raw.igst_rate as string),
  };
}

function serializeTotals(t: InvoiceTotals): unknown {
  return {
    total_taxable: decToStr(t.total_taxable),
    total_cgst: decToStr(t.total_cgst),
    total_sgst: decToStr(t.total_sgst),
    total_igst: decToStr(t.total_igst),
    raw_total: decToStr(t.raw_total),
    round_off: decToStr(t.round_off),
    grand_total: decToStr(t.grand_total),
  };
}
function deserializeTotals(raw: Record<string, unknown>): InvoiceTotals {
  return {
    total_taxable: strToDec(raw.total_taxable as string),
    total_cgst: strToDec(raw.total_cgst as string),
    total_sgst: strToDec(raw.total_sgst as string),
    total_igst: strToDec(raw.total_igst as string),
    raw_total: strToDec(raw.raw_total as string),
    round_off: strToDec(raw.round_off as string),
    grand_total: strToDec(raw.grand_total as string),
  };
}

function serializeTaxRow(r: TaxSummaryRow): unknown {
  return {
    ...r,
    tax_rate: decToStr(r.tax_rate),
    taxable_value: decToStr(r.taxable_value),
    cgst_amount: decToStr(r.cgst_amount),
    sgst_amount: decToStr(r.sgst_amount),
    igst_amount: decToStr(r.igst_amount),
    total_tax: decToStr(r.total_tax),
  };
}
function deserializeTaxRow(raw: Record<string, unknown>): TaxSummaryRow {
  return {
    ...(raw as unknown as TaxSummaryRow),
    tax_rate: strToDec(raw.tax_rate as string),
    taxable_value: strToDec(raw.taxable_value as string),
    cgst_amount: strToDec(raw.cgst_amount as string),
    sgst_amount: strToDec(raw.sgst_amount as string),
    igst_amount: strToDec(raw.igst_amount as string),
    total_tax: strToDec(raw.total_tax as string),
  };
}

export function serializeSnapshot(snap: InvoiceSnapshot): string {
  const obj = {
    ...snap,
    lines: snap.lines.map(serializeLine),
    totals: serializeTotals(snap.totals),
    tax_summary: snap.tax_summary.map(serializeTaxRow),
    tax_rate_config: serializeConfig(snap.tax_rate_config),
  };
  return JSON.stringify(obj);
}

export function deserializeSnapshot(json: string): InvoiceSnapshot {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    ...(raw as unknown as InvoiceSnapshot),
    lines: (raw.lines as Record<string, unknown>[]).map(deserializeLine),
    totals: deserializeTotals(raw.totals as Record<string, unknown>),
    tax_summary: (raw.tax_summary as Record<string, unknown>[]).map(deserializeTaxRow),
    tax_rate_config: deserializeConfig(raw.tax_rate_config as Record<string, unknown>),
  };
}

export function serializeReferences(refs: InvoiceReferences): string {
  return JSON.stringify(refs);
}

export function deserializeReferences(json: string): InvoiceReferences {
  return JSON.parse(json) as InvoiceReferences;
}

// --- Challan snapshot (reuses the money/quantity Decimal round-trip above) ---

function serializeChallanLine(line: ChallanLine): unknown {
  return {
    ...line,
    quantity: decToStr(line.quantity),
    rate: decToStr(line.rate),
    discount_percent: decToStr(line.discount_percent),
    tax_rate: decToStr(line.tax_rate),
    taxable_amount: line.taxable_amount ? decToStr(line.taxable_amount) : null,
    cgst_amount: line.cgst_amount ? decToStr(line.cgst_amount) : null,
    sgst_amount: line.sgst_amount ? decToStr(line.sgst_amount) : null,
    igst_amount: line.igst_amount ? decToStr(line.igst_amount) : null,
  };
}

function deserializeChallanLine(raw: Record<string, unknown>): ChallanLine {
  return {
    ...(raw as unknown as ChallanLine),
    quantity: strToDec(raw.quantity as string),
    rate: strToDec(raw.rate as string),
    discount_percent: strToDec(raw.discount_percent as string),
    tax_rate: strToDec(raw.tax_rate as string),
    taxable_amount: raw.taxable_amount ? strToDec(raw.taxable_amount as string) : null,
    cgst_amount: raw.cgst_amount ? strToDec(raw.cgst_amount as string) : null,
    sgst_amount: raw.sgst_amount ? strToDec(raw.sgst_amount as string) : null,
    igst_amount: raw.igst_amount ? strToDec(raw.igst_amount as string) : null,
  };
}

export function serializeChallanSnapshot(snap: ChallanSnapshot): string {
  const obj = {
    ...snap,
    lines: snap.lines.map(serializeChallanLine),
    totals: serializeTotals(snap.totals),
    tax_summary: snap.tax_summary.map(serializeTaxRow),
    tax_rate_config: serializeConfig(snap.tax_rate_config),
  };
  return JSON.stringify(obj);
}

export function deserializeChallanSnapshot(json: string): ChallanSnapshot {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    ...(raw as unknown as ChallanSnapshot),
    lines: (raw.lines as Record<string, unknown>[]).map(deserializeChallanLine),
    totals: deserializeTotals(raw.totals as Record<string, unknown>),
    tax_summary: (raw.tax_summary as Record<string, unknown>[]).map(deserializeTaxRow),
    tax_rate_config: deserializeConfig(raw.tax_rate_config as Record<string, unknown>),
  };
}

// --- Order snapshot (same Decimal round-trip as invoice/challan) ---

function serializeOrderLine(line: OrderLine): unknown {
  return {
    ...line,
    quantity: decToStr(line.quantity),
    rate: decToStr(line.rate),
    discount_percent: decToStr(line.discount_percent),
    tax_rate: decToStr(line.tax_rate),
    taxable_amount: line.taxable_amount ? decToStr(line.taxable_amount) : null,
    cgst_amount: line.cgst_amount ? decToStr(line.cgst_amount) : null,
    sgst_amount: line.sgst_amount ? decToStr(line.sgst_amount) : null,
    igst_amount: line.igst_amount ? decToStr(line.igst_amount) : null,
  };
}

function deserializeOrderLine(raw: Record<string, unknown>): OrderLine {
  return {
    ...(raw as unknown as OrderLine),
    quantity: strToDec(raw.quantity as string),
    rate: strToDec(raw.rate as string),
    discount_percent: strToDec(raw.discount_percent as string),
    tax_rate: strToDec(raw.tax_rate as string),
    taxable_amount: raw.taxable_amount ? strToDec(raw.taxable_amount as string) : null,
    cgst_amount: raw.cgst_amount ? strToDec(raw.cgst_amount as string) : null,
    sgst_amount: raw.sgst_amount ? strToDec(raw.sgst_amount as string) : null,
    igst_amount: raw.igst_amount ? strToDec(raw.igst_amount as string) : null,
  };
}

export function serializeOrderSnapshot(snap: OrderSnapshot): string {
  const obj = {
    ...snap,
    lines: snap.lines.map(serializeOrderLine),
    totals: serializeTotals(snap.totals),
    tax_summary: snap.tax_summary.map(serializeTaxRow),
    tax_rate_config: serializeConfig(snap.tax_rate_config),
  };
  return JSON.stringify(obj);
}

export function deserializeOrderSnapshot(json: string): OrderSnapshot {
  const raw = JSON.parse(json) as Record<string, unknown>;
  return {
    ...(raw as unknown as OrderSnapshot),
    lines: (raw.lines as Record<string, unknown>[]).map(deserializeOrderLine),
    totals: deserializeTotals(raw.totals as Record<string, unknown>),
    tax_summary: (raw.tax_summary as Record<string, unknown>[]).map(deserializeTaxRow),
    tax_rate_config: deserializeConfig(raw.tax_rate_config as Record<string, unknown>),
  };
}
