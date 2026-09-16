import type Database from 'better-sqlite3';
import type { PartyGroup } from '@shared/domain/party';
import { toCanonicalUuid } from './mappers';

export interface PartyGroupRepository {
  get(id: string): PartyGroup | null;
  getByName(name: string): PartyGroup | null;
  listAll(includeArchived: boolean): PartyGroup[];
  save(group: PartyGroup): void;
}

interface GroupRow {
  id: string;
  name: string;
  is_active: number;
}

function toGroup(row: GroupRow): PartyGroup {
  return { id: toCanonicalUuid(row.id), name: row.name, is_active: row.is_active === 1 };
}

export class SqlitePartyGroupRepository implements PartyGroupRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): PartyGroup | null {
    const row = this.db.prepare('SELECT * FROM party_groups WHERE id = ?').get(toCanonicalUuid(id)) as
      | GroupRow
      | undefined;
    return row ? toGroup(row) : null;
  }

  getByName(name: string): PartyGroup | null {
    // Uniqueness is enforced among active groups only.
    const row = this.db
      .prepare('SELECT * FROM party_groups WHERE name = ? AND is_active = 1')
      .get(name.trim()) as GroupRow | undefined;
    return row ? toGroup(row) : null;
  }

  listAll(includeArchived: boolean): PartyGroup[] {
    const where = includeArchived ? '' : 'WHERE is_active = 1';
    const rows = this.db
      .prepare(`SELECT * FROM party_groups ${where} ORDER BY name COLLATE NOCASE ASC`)
      .all() as GroupRow[];
    return rows.map(toGroup);
  }

  save(group: PartyGroup): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO party_groups (id, name, is_active) VALUES (@id, @name, @is_active)`,
      )
      .run({
        id: toCanonicalUuid(group.id),
        name: group.name,
        is_active: group.is_active ? 1 : 0,
      });
  }
}
