import type Database from 'better-sqlite3';

export interface BomRecord {
  id: string;
  product_id: string;
  raw_product_id: string;
  quantity: string;
  created_at: string;
}

export interface ProductionBatchRecord {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: string;
  production_date: string;
  cost_paise: number;
  note: string;
  materials_json: string;
  created_at: string;
}

export class ManufacturingRepository {
  constructor(private readonly db: Database.Database) {}

  getBom(productId: string): BomRecord[] {
    const stmt = this.db.prepare(
      'SELECT id, product_id, raw_product_id, quantity, created_at FROM product_boms WHERE product_id = ? ORDER BY created_at ASC',
    );
    return stmt.all(productId) as BomRecord[];
  }

  saveBom(
    productId: string,
    lines: Array<{ id: string; raw_product_id: string; quantity: string }>,
  ): void {
    const deleteStmt = this.db.prepare('DELETE FROM product_boms WHERE product_id = ?');
    const insertStmt = this.db.prepare(
      'INSERT INTO product_boms (id, product_id, raw_product_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)',
    );
    const updateProductStmt = this.db.prepare(
      'UPDATE products SET made_here = ? WHERE id = ?',
    );

    const now = new Date().toISOString();
    deleteStmt.run(productId);
    for (const l of lines) {
      insertStmt.run(l.id, productId, l.raw_product_id, String(l.quantity), now);
    }
    updateProductStmt.run(lines.length > 0 ? 1 : 0, productId);
  }

  insertBatch(record: ProductionBatchRecord): void {
    const stmt = this.db.prepare(
      `INSERT INTO production_batches (
        id, product_id, product_name, unit, quantity,
        production_date, cost_paise, note, materials_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    stmt.run(
      record.id,
      record.product_id,
      record.product_name,
      record.unit,
      record.quantity,
      record.production_date,
      record.cost_paise,
      record.note,
      record.materials_json,
      record.created_at,
    );
  }

  listBatches(): ProductionBatchRecord[] {
    const stmt = this.db.prepare(
      'SELECT * FROM production_batches ORDER BY production_date DESC, created_at DESC',
    );
    return stmt.all() as ProductionBatchRecord[];
  }

  getBatch(id: string): ProductionBatchRecord | null {
    const stmt = this.db.prepare('SELECT * FROM production_batches WHERE id = ?');
    const row = stmt.get(id);
    return (row as ProductionBatchRecord) || null;
  }

  deleteBatch(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM production_batches WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
