import type Database from 'better-sqlite3';
import type { ProductGroup } from '@shared/domain/product';
import { toCanonicalUuid } from './mappers';

export interface ProductGroupRepository {
  get(id: string): ProductGroup | null;
  getByName(name: string): ProductGroup | null;
  listAll(includeArchived: boolean): ProductGroup[];
  save(group: ProductGroup): void;
}

interface GroupRow {
  id: string;
  name: string;
  is_active: number;
}

function toGroup(row: GroupRow): ProductGroup {
  return { id: toCanonicalUuid(row.id), name: row.name, is_active: row.is_active === 1 };
}

export class SqliteProductGroupRepository implements ProductGroupRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): ProductGroup | null {
    const row = this.db
      .prepare('SELECT * FROM product_groups WHERE id = ?')
      .get(toCanonicalUuid(id)) as GroupRow | undefined;
    return row ? toGroup(row) : null;
  }

  getByName(name: string): ProductGroup | null {
    const row = this.db
      .prepare('SELECT * FROM product_groups WHERE name = ? AND is_active = 1')
      .get(name.trim()) as GroupRow | undefined;
    return row ? toGroup(row) : null;
  }

  listAll(includeArchived: boolean): ProductGroup[] {
    const where = includeArchived ? '' : 'WHERE is_active = 1';
    const rows = this.db
      .prepare(`SELECT * FROM product_groups ${where} ORDER BY name COLLATE NOCASE ASC`)
      .all() as GroupRow[];
    return rows.map(toGroup);
  }

  save(group: ProductGroup): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO product_groups (id, name, is_active) VALUES (@id, @name, @is_active)`,
      )
      .run({ id: toCanonicalUuid(group.id), name: group.name, is_active: group.is_active ? 1 : 0 });
  }
}
