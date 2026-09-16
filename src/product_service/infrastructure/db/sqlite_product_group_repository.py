"""SQLite implementation of :class:`ProductGroupRepository`.

Uses the ``product_groups`` table from migration ``0004_products.sql``.
Parameterized SQL only; participates in the caller's transaction (D-026).
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from product_service.domain.models import ProductGroup
from product_service.infrastructure.db.mappers import group_to_row, row_to_group

_COLUMNS = "id, name, is_active"


class SqliteProductGroupRepository:
    """SQLite-backed product-group repository."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, group_id: uuid.UUID) -> ProductGroup | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM product_groups WHERE id = ?",
            (to_canonical(group_id),),
        ).fetchone()
        return None if row is None else row_to_group(row)

    def get_by_name(self, name: str) -> ProductGroup | None:
        clean = name.strip()
        if not clean:
            return None
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM product_groups "
            "WHERE name = ? COLLATE NOCASE AND is_active = 1 LIMIT 1",
            (clean,),
        ).fetchone()
        return None if row is None else row_to_group(row)

    def list_all(self, *, include_archived: bool = False) -> Sequence[ProductGroup]:
        query = f"SELECT {_COLUMNS} FROM product_groups"
        if not include_archived:
            query += " WHERE is_active = 1"
        query += " ORDER BY name COLLATE NOCASE ASC"
        rows = self._conn.execute(query).fetchall()
        return [row_to_group(r) for r in rows]

    def save(self, group: ProductGroup) -> None:
        row = group_to_row(group)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO product_groups ({columns}) VALUES ({placeholders})",
            row,
        )

    def archive(self, group_id: uuid.UUID) -> bool:
        cur = self._conn.execute(
            "UPDATE product_groups SET is_active = 0 WHERE id = ?",
            (to_canonical(group_id),),
        )
        return cur.rowcount > 0

    def count_products_in_group(self, group_id: uuid.UUID) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM products WHERE product_group_id = ?",
            (to_canonical(group_id),),
        ).fetchone()
        return 0 if row is None else int(row["n"])
