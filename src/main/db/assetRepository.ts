import type Database from 'better-sqlite3';
import type { Asset } from '@shared/domain/models';
import type { AssetRepository } from '@shared/domain/repositories';
import { toCanonicalUuid } from './mappers';

interface AssetRow {
  id: string;
  kind: string;
  version: number;
  sha256: string;
  stored_path: string;
  created_at: string;
}

export class SqliteAssetRepository implements AssetRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): Asset | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(toCanonicalUuid(id)) as
      | AssetRow
      | undefined;
    if (!row) return null;
    return {
      id: toCanonicalUuid(row.id),
      kind: row.kind,
      version: row.version,
      sha256: row.sha256,
      stored_path: row.stored_path,
      created_at: row.created_at,
    };
  }

  save(asset: Asset): void {
    this.db
      .prepare(
        `INSERT INTO assets (id, kind, version, sha256, stored_path, created_at)
         VALUES (@id, @kind, @version, @sha256, @stored_path, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           kind=@kind, version=@version, sha256=@sha256, stored_path=@stored_path`,
      )
      .run({
        id: toCanonicalUuid(asset.id),
        kind: asset.kind,
        version: asset.version,
        sha256: asset.sha256,
        stored_path: asset.stored_path,
        created_at: asset.created_at,
      });
  }
}
