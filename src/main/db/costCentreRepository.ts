import type Database from 'better-sqlite3';

export interface CostCentreRow {
  id: string;
  name: string;
  code: string;
  description: string;
  active: number; // 1 or 0
  created_at: string;
}

export class CostCentreRepository {
  constructor(private readonly db: Database.Database) {}

  save(row: CostCentreRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO cost_centres (id, name, code, description, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         code = excluded.code,
         description = excluded.description,
         active = excluded.active`,
    );
    stmt.run(row.id, row.name, row.code, row.description, row.active, row.created_at);
  }

  listAll(): CostCentreRow[] {
    const stmt = this.db.prepare('SELECT * FROM cost_centres ORDER BY name ASC');
    return stmt.all() as CostCentreRow[];
  }

  archive(id: string): boolean {
    const stmt = this.db.prepare('UPDATE cost_centres SET active = 0 WHERE id = ?');
    return stmt.run(id).changes > 0;
  }
}
