import type Database from 'better-sqlite3';

export interface CashEntryRow {
  id: string;
  type: 'in' | 'out';
  amount_paise: number;
  entry_date: string;
  name: string;
  note: string;
  category: string;
  created_at: string;
}

export class CashBookRepository {
  constructor(private readonly db: Database.Database) {}

  save(entry: CashEntryRow): void {
    const stmt = this.db.prepare(
      `INSERT INTO cash_entries (id, type, amount_paise, entry_date, name, note, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         amount_paise = excluded.amount_paise,
         entry_date = excluded.entry_date,
         name = excluded.name,
         note = excluded.note,
         category = excluded.category`,
    );
    stmt.run(
      entry.id,
      entry.type,
      entry.amount_paise,
      entry.entry_date,
      entry.name,
      entry.note,
      entry.category,
      entry.created_at,
    );
  }

  listAll(): CashEntryRow[] {
    const stmt = this.db.prepare('SELECT * FROM cash_entries ORDER BY entry_date DESC, created_at DESC');
    return stmt.all() as CashEntryRow[];
  }

  delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM cash_entries WHERE id = ?');
    return stmt.run(id).changes > 0;
  }
}
