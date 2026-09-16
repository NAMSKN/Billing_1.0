import type Database from 'better-sqlite3';
import { toCanonicalUuid } from './mappers';

/**
 * Append-only stock movement ledger. Current stock is derived by summing
 * delta_millis per product — there is no stored balance column. Repository
 * participates in the caller's transaction; it never begins/commits its own.
 */

export type StockReason = 'OPENING' | 'ADJUSTMENT' | 'SALE' | 'PURCHASE' | 'RESTORE';

export interface StockMovement {
  id: string;
  product_id: string;
  delta_millis: number;
  reason: StockReason;
  reference_type: string;
  reference_id: string | null;
  remarks: string;
  created_at: string;
}

interface MovementRow {
  id: string;
  product_id: string;
  delta_millis: number;
  reason: string;
  reference_type: string;
  reference_id: string | null;
  remarks: string;
  created_at: string;
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: toCanonicalUuid(row.id),
    product_id: toCanonicalUuid(row.product_id),
    delta_millis: row.delta_millis,
    reason: row.reason as StockReason,
    reference_type: row.reference_type,
    reference_id: row.reference_id ? toCanonicalUuid(row.reference_id) : null,
    remarks: row.remarks,
    created_at: row.created_at,
  };
}

export interface MovementQuery {
  from?: string; // ISO date (yyyy-mm-dd) inclusive
  to?: string; // ISO date inclusive
}

export interface StockMovementRepository {
  insert(movement: StockMovement): void;
  /** Current stock (integer millis) for one product = Σ delta. */
  currentMillis(productId: string): number;
  /** Bulk current stock for all products: productId -> millis. */
  currentMillisMap(): Map<string, number>;
  /** Movements for a product, newest first, optionally within a date range. */
  listForProduct(productId: string, query?: MovementQuery): StockMovement[];
  /** Product ids that already have an OPENING movement (for idempotent backfill). */
  productIdsWithOpening(): Set<string>;
}

export class SqliteStockMovementRepository implements StockMovementRepository {
  constructor(private readonly db: Database.Database) {}

  insert(m: StockMovement): void {
    this.db
      .prepare(
        `INSERT INTO stock_movements
           (id, product_id, delta_millis, reason, reference_type, reference_id, remarks, created_at)
         VALUES (@id, @product_id, @delta_millis, @reason, @reference_type, @reference_id, @remarks, @created_at)`,
      )
      .run({
        id: toCanonicalUuid(m.id),
        product_id: toCanonicalUuid(m.product_id),
        delta_millis: m.delta_millis,
        reason: m.reason,
        reference_type: m.reference_type,
        reference_id: m.reference_id ? toCanonicalUuid(m.reference_id) : null,
        remarks: m.remarks,
        created_at: m.created_at,
      });
  }

  currentMillis(productId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(delta_millis), 0) AS total FROM stock_movements WHERE product_id = ?')
      .get(toCanonicalUuid(productId)) as { total: number };
    return row.total;
  }

  currentMillisMap(): Map<string, number> {
    const rows = this.db
      .prepare('SELECT product_id, COALESCE(SUM(delta_millis), 0) AS total FROM stock_movements GROUP BY product_id')
      .all() as { product_id: string; total: number }[];
    const map = new Map<string, number>();
    for (const r of rows) map.set(toCanonicalUuid(r.product_id), r.total);
    return map;
  }

  listForProduct(productId: string, query: MovementQuery = {}): StockMovement[] {
    const clauses = ['product_id = ?'];
    const params: unknown[] = [toCanonicalUuid(productId)];
    if (query.from) {
      clauses.push('created_at >= ?');
      params.push(query.from);
    }
    if (query.to) {
      // Inclusive end-of-day.
      clauses.push('created_at <= ?');
      params.push(`${query.to}T23:59:59.999Z`);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM stock_movements WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC, rowid ASC`,
      )
      .all(...params) as MovementRow[];
    return rows.map(toMovement);
  }

  productIdsWithOpening(): Set<string> {
    const rows = this.db
      .prepare("SELECT DISTINCT product_id FROM stock_movements WHERE reason = 'OPENING'")
      .all() as { product_id: string }[];
    return new Set(rows.map((r) => toCanonicalUuid(r.product_id)));
  }
}
