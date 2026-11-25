/**
 * Wire DTOs for the stock ledger. Quantities cross IPC as decimal strings.
 */

export interface StockRowDto {
  product_id: string;
  name: string;
  group_name: string;
  unit: string;
  current: string;
  low_stock_alert: string | null;
  is_low: boolean;
}

export interface StockAdjustRequest {
  product_id: string;
  /** Absolute target stock. The main process computes the delta. */
  final_qty: string;
  remarks: string;
}

export interface StockAdjustManyRequest {
  entries: StockAdjustRequest[];
}

export interface StockAdjustResultDto {
  adjusted: number;
  unchanged: number;
}

/** One rendered ledger row (Product Log). */
export interface StockLogEntryDto {
  date: string; // yyyy-mm-dd
  info: string; // Transaction Info (e.g. "Opening Stock." / remarks)
  company_name: string; // populated by future auto-post; blank for manual
  doc_no: string;
  unit_price: string;
  stock_in: string; // qty in (blank when out)
  stock_out: string; // qty out (blank when in)
  uom: string;
}

export interface StockLogRequest {
  product_id: string;
  from?: string;
  to?: string;
}

export interface StockLogResponse {
  product_name: string;
  unit: string;
  entries: StockLogEntryDto[];
}

// Bulk import
export interface StockImportRowDto {
  row_number: number;
  name: string;
  current: string;
  target: string | null;
  delta: string | null;
  error: string | null;
}
export interface StockImportPreviewDto {
  token: string;
  header_errors: string[];
  rows: StockImportRowDto[];
  adjust_count: number;
  unchanged_count: number;
  error_count: number;
}
export interface StockImportResultDto {
  adjusted: number;
  unchanged: number;
  skipped: number;
}
