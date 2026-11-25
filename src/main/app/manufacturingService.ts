import type Database from 'better-sqlite3';
import Decimal from 'decimal.js';
import { withImmediateTransaction } from './unitOfWork';
import type { ManufacturingRepository } from '../db/manufacturingRepository';
import type { StockService } from './stockService';
import type { ProductService } from './productService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';
import {
  buildProduction,
  type BomLine,
  type MaterialRequirement,
  type ProductWithBom,
} from '@shared/domain/manufacturing';

export interface ProductionBatchDto {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: string;
  productionDate: string;
  costRupees: string;
  note: string;
  materials: MaterialRequirement[];
  createdAt: string;
}

export class ManufacturingService {
  constructor(
    private readonly db: Database.Database,
    private readonly repo: ManufacturingRepository,
    private readonly stock: StockService,
    private readonly products: ProductService,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  getBom(productId: string): BomLine[] {
    const records = this.repo.getBom(productId);
    return records.map((r) => ({
      productId: r.raw_product_id,
      qty: r.quantity,
    }));
  }

  saveBom(productId: string, lines: BomLine[]): void {
    withImmediateTransaction(this.db, () => {
      this.repo.saveBom(
        productId,
        lines.map((l) => ({
          id: this.ids(),
          raw_product_id: l.productId,
          quantity: String(l.qty),
        })),
      );
    });
  }

  recordProduction(params: {
    productId: string;
    quantity: number;
    date: string;
    note?: string;
  }): ProductionBatchDto {
    return withImmediateTransaction(this.db, () => {
      const allProducts = this.products.list({ includeArchived: false });
      const target = allProducts.find((p) => p.id === params.productId);
      if (!target) throw new Error('Product not found in catalog');

      const bomLines = this.getBom(params.productId);
      const productWithBom: ProductWithBom = {
        id: target.id,
        name: target.name,
        unit: target.unit_of_measurement,
        stock: this.stock.currentStock(target.id).toNumber(),
        purchase_price_paise: target.purchase_price.times(100).toNumber(),
        sell_price_paise: target.sell_price.times(100).toNumber(),
        madeHere: true,
        bom: bomLines,
      };

      const catalogWithBoms: ProductWithBom[] = allProducts.map((p) => ({
        id: p.id,
        name: p.name,
        unit: p.unit_of_measurement,
        stock: this.stock.currentStock(p.id).toNumber(),
        purchase_price_paise: p.purchase_price.times(100).toNumber(),
        sell_price_paise: p.sell_price.times(100).toNumber(),
        madeHere: p.id === target.id ? true : false,
        bom: p.id === target.id ? bomLines : undefined,
      }));

      const stockMap = new Map<string, number>();
      for (const p of allProducts) {
        stockMap.set(p.id, this.stock.currentStock(p.id).toNumber());
      }

      const batchId = this.ids();
      const built = buildProduction({
        product: productWithBom,
        qty: params.quantity,
        date: params.date,
        note: params.note,
        products: catalogWithBoms,
        currentStockMap: stockMap,
        id: batchId,
      });

      if (built.error || !built.entry) {
        throw new Error(built.error || 'Failed to construct production batch');
      }

      const entry = built.entry;
      const createdAt = this.clock.now().toISOString();

      // 1. Save production batch record
      this.repo.insertBatch({
        id: entry.id,
        product_id: entry.productId,
        product_name: entry.productName,
        unit: entry.unit,
        quantity: String(entry.qty),
        production_date: entry.date,
        cost_paise: Math.round(entry.cost * 100),
        note: entry.note,
        materials_json: JSON.stringify(entry.materials),
        created_at: createdAt,
      });

      // 2. Post stock deduction for each raw material
      for (const m of entry.materials) {
        this.stock.postMovement(
          m.productId,
          new Decimal(-m.qtyUsed),
          'ADJUSTMENT',
          'PRODUCTION_BATCH',
          entry.id,
          `Consumed for manufacturing ${entry.productName} x ${entry.qty}`,
          true,
        );
      }

      // 3. Post stock increment for the finished product
      this.stock.postMovement(
        entry.productId,
        new Decimal(entry.qty),
        'ADJUSTMENT',
        'PRODUCTION_BATCH',
        entry.id,
        `Manufactured from raw materials batch ${entry.id}`,
        true,
      );

      return {
        id: entry.id,
        productId: entry.productId,
        productName: entry.productName,
        unit: entry.unit,
        quantity: String(entry.qty),
        productionDate: entry.date,
        costRupees: (entry.cost).toFixed(2),
        note: entry.note,
        materials: entry.materials,
        createdAt: entry.createdAt,
      };
    });
  }

  listBatches(): ProductionBatchDto[] {
    const rows = this.repo.listBatches();
    return rows.map((r) => {
      let materials: MaterialRequirement[] = [];
      try {
        materials = JSON.parse(r.materials_json);
      } catch {
        materials = [];
      }
      return {
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        productionDate: r.production_date,
        costRupees: (r.cost_paise / 100).toFixed(2),
        note: r.note,
        materials,
        createdAt: r.created_at,
      };
    });
  }

  deleteProduction(id: string): boolean {
    return withImmediateTransaction(this.db, () => {
      const batch = this.repo.getBatch(id);
      if (!batch) return false;

      let materials: MaterialRequirement[] = [];
      try {
        materials = JSON.parse(batch.materials_json);
      } catch {
        materials = [];
      }

      // Reverse raw materials: credit them back
      for (const m of materials) {
        this.stock.postMovement(
          m.productId,
          new Decimal(m.qtyUsed),
          'RESTORE',
          'PRODUCTION_BATCH_REVERT',
          batch.id,
          `Restored: deleted production batch ${batch.id}`,
          true,
        );
      }

      // Reverse finished product: deduct it back
      this.stock.postMovement(
        batch.product_id,
        new Decimal(-Number(batch.quantity)),
        'RESTORE',
        'PRODUCTION_BATCH_REVERT',
        batch.id,
        `Deducted: deleted production batch ${batch.id}`,
        true,
      );

      return this.repo.deleteBatch(id);
    });
  }
}
