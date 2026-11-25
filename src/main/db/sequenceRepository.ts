import type Database from 'better-sqlite3';
import type { SequenceState } from '@shared/domain/models';
import type { SequenceRepository } from '@shared/domain/repositories';
import { toCanonicalUuid } from './mappers';

interface SequenceRow {
  company_id: string;
  financial_year: string;
  prefix: string;
  next_sequence: number;
  high_water_mark: number;
}

export class SqliteSequenceRepository implements SequenceRepository {
  constructor(private readonly db: Database.Database) {}

  get(companyId: string, financialYear: string, prefix: string): SequenceState | null {
    const row = this.db
      .prepare(
        'SELECT * FROM invoice_sequences WHERE company_id = ? AND financial_year = ? AND prefix = ?',
      )
      .get(toCanonicalUuid(companyId), financialYear, prefix) as SequenceRow | undefined;
    if (!row) return null;
    return {
      company_id: toCanonicalUuid(row.company_id),
      financial_year: row.financial_year,
      prefix: row.prefix,
      next_sequence: row.next_sequence,
      high_water_mark: row.high_water_mark,
    };
  }

  /** Upsert the sequence state. Participates in the caller's transaction. */
  save(state: SequenceState): void {
    this.db
      .prepare(
        `INSERT INTO invoice_sequences (company_id, financial_year, prefix, next_sequence, high_water_mark)
         VALUES (@company_id, @financial_year, @prefix, @next_sequence, @high_water_mark)
         ON CONFLICT(company_id, financial_year, prefix) DO UPDATE SET
           next_sequence=@next_sequence, high_water_mark=@high_water_mark`,
      )
      .run({
        company_id: toCanonicalUuid(state.company_id),
        financial_year: state.financial_year,
        prefix: state.prefix,
        next_sequence: state.next_sequence,
        high_water_mark: state.high_water_mark,
      });
  }
}
