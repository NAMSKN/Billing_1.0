"""SQLite implementation of :class:`PartyGroupRepository`.

Uses the ``party_groups`` table from migration ``0003_parties.sql``.
Parameterized SQL only; participates in the caller's transaction (D-026).
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from vendor_customer.domain.models import PartyGroup
from vendor_customer.infrastructure.db.mappers import group_to_row, row_to_group

_COLUMNS = "id, name, is_active"


class SqlitePartyGroupRepository:
    """SQLite-backed party-group repository."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, group_id: uuid.UUID) -> PartyGroup | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM party_groups WHERE id = ?",
            (to_canonical(group_id),),
        ).fetchone()
        return None if row is None else row_to_group(row)

    def get_by_name(self, name: str) -> PartyGroup | None:
        clean = name.strip()
        if not clean:
            return None
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM party_groups "
            "WHERE name = ? COLLATE NOCASE AND is_active = 1 LIMIT 1",
            (clean,),
        ).fetchone()
        return None if row is None else row_to_group(row)

    def list_all(self, *, include_archived: bool = False) -> Sequence[PartyGroup]:
        query = f"SELECT {_COLUMNS} FROM party_groups"
        if not include_archived:
            query += " WHERE is_active = 1"
        query += " ORDER BY name COLLATE NOCASE ASC"
        rows = self._conn.execute(query).fetchall()
        return [row_to_group(r) for r in rows]

    def save(self, group: PartyGroup) -> None:
        row = group_to_row(group)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO party_groups ({columns}) VALUES ({placeholders})",
            row,
        )

    def archive(self, group_id: uuid.UUID) -> bool:
        cur = self._conn.execute(
            "UPDATE party_groups SET is_active = 0 WHERE id = ?",
            (to_canonical(group_id),),
        )
        return cur.rowcount > 0

    def count_parties_in_group(self, group_id: uuid.UUID) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) AS n FROM parties WHERE group_id = ?",
            (to_canonical(group_id),),
        ).fetchone()
        return 0 if row is None else int(row["n"])
