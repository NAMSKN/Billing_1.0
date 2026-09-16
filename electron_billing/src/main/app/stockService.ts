import type Decimal from 'decimal.js';
import { Money, fromMillis, toMillis } from '@shared/domain/money';
import { tracksStock } from '@shared/domain/product';
import type { ProductService } from './productService';
import type {
  MovementQuery,
  StockMovement,
  StockMovementRepository,
  StockReason,
} from '../db/stockMovementRepository';
import { withImmediateTransaction } from './unitOfWork';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';
import type Database from 'better-sqlite3';

/**
 * Stock service. Current stock is DERIVED (Σ movement deltas); nothing is a
 * stored balance. Manual adjustments take an ABSOLUTE target and post the
 * computed delta as one ADJUSTMENT movement. Opening quantities from the
 * product master are backfilled once as OPENING movements (idempotent).
 */

export interface AdjustResult {
  product_id: string;
  previous: Decimal;
  final: Decimal;
  delta: Decimal;
  changed: boolean;
}

export class StockService {
  constructor(
    private readonly db: Database.Database,
    private readonly movements: StockMovementRepository,
    private readonly products: ProductService,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  /** Current stock as a Decimal (3 dp) for one product. */
  currentStock(productId: string): Decimal {
    return fromMillis(this.movements.currentMillis(productId));
  }

  /** Bulk current stock: productId -> Decimal. Products with no movements = 0. */
  currentStockMap(): Map<string, Decimal> {
    const millis = this.movements.currentMillisMap();
    const map = new Map<string, Decimal>();
    for (const [id, m] of millis) map.set(id, fromMillis(m));
    return map;
  }

  movementsFor(productId: string, query?: MovementQuery): StockMovement[] {
    return this.movements.listForProduct(productId, query);
  }

  /**
   * Set a product's stock to an absolute target, posting one ADJUSTMENT for the
   * delta. Returns the before/after/delta; `changed=false` when already at the
   * target (no movement written). Caller may wrap several of these in a
   * transaction; a single call opens its own if not already in one.
   */
  adjustToFinal(
    productId: string,
    finalQty: Decimal,
    remarks: string,
    inTransaction = false,
  ): AdjustResult {
    const previousMillis = this.movements.currentMillis(productId);
    const finalMillis = toMillis(finalQty);
    const deltaMillis = finalMillis - previousMillis;
    const result: AdjustResult = {
      product_id: productId,
      previous: fromMillis(previousMillis),
      final: fromMillis(finalMillis),
      delta: fromMillis(deltaMillis),
      changed: deltaMillis !== 0,
    };
    if (!result.changed) return result;

    const write = () =>
      this.movements.insert({
        id: this.ids(),
        product_id: productId,
        delta_millis: deltaMillis,
        reason: 'ADJUSTMENT',
        reference_type: 'MANUAL',
        reference_id: null,
        remarks: remarks.trim(),
        created_at: this.clock.now().toISOString(),
      });

    if (inTransaction) write();
    else withImmediateTransaction(this.db, write);
    return result;
  }

  /** Apply several absolute-target adjustments atomically. */
  adjustMany(entries: { productId: string; finalQty: Decimal; remarks: string }[]): AdjustResult[] {
    return withImmediateTransaction(this.db, () =>
      entries.map((e) => this.adjustToFinal(e.productId, e.finalQty, e.remarks, true)),
    );
  }

  /** Post a raw movement (for future auto-post seams). */
  postMovement(
    productId: string,
    delta: Decimal,
    reason: StockReason,
    referenceType: string,
    referenceId: string | null,
    remarks: string,
    inTransaction = false,
  ): void {
    const write = () =>
      this.movements.insert({
        id: this.ids(),
        product_id: productId,
        delta_millis: toMillis(delta),
        reason,
        reference_type: referenceType,
        reference_id: referenceId,
        remarks: remarks.trim(),
        created_at: this.clock.now().toISOString(),
      });
    if (inTransaction) write();
    else withImmediateTransaction(this.db, write);
  }

  /**
   * Backfill an OPENING movement from each product's opening_qty for products
   * that don't yet have one. Idempotent; safe to run on every startup.
   */
  backfillOpening(): number {
    const already = this.movements.productIdsWithOpening();
    const candidates = this.products
      .list({ includeArchived: true })
      .filter((p) => tracksStock(p.item_type) && p.opening_qty !== null && !already.has(p.id));
    if (candidates.length === 0) return 0;

    return withImmediateTransaction(this.db, () => {
      const now = this.clock.now().toISOString();
      for (const p of candidates) {
        this.movements.insert({
          id: this.ids(),
          product_id: p.id,
          delta_millis: toMillis(p.opening_qty ?? new Money(0)),
          reason: 'OPENING',
          reference_type: 'OPENING',
          reference_id: null,
          remarks: 'Opening Stock.',
          created_at: now,
        });
      }
      return candidates.length;
    });
  }
}
