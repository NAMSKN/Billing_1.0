"""SQLite implementation of :class:`AssetRepository`.

Participates in the caller's transaction (DECISIONS D-026). Parameterized SQL.
"""

from __future__ import annotations

import sqlite3
import uuid

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import Asset
from invoice_generator.infrastructure.db.mappers import asset_to_row, row_to_asset

_COLUMNS = "id, kind, version, sha256, stored_path, created_at"


class SqliteAssetRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, asset_id: uuid.UUID) -> Asset | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM assets WHERE id = ?",
            (to_canonical(asset_id),),
        ).fetchone()
        return None if row is None else row_to_asset(row)

    def save(self, asset: Asset) -> None:
        row = asset_to_row(asset)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO assets ({columns}) VALUES ({placeholders})",
            row,
        )
