"""SQLite implementation of :class:`SequenceRepository`.

Participates in the caller's transaction (DECISIONS D-026): the numbering
service opens the transaction (``BEGIN IMMEDIATE``) and this repository reads
and writes the sequence row within it, never committing on its own.
Parameterized SQL only.
"""

from __future__ import annotations

import sqlite3
import uuid

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import SequenceState
from invoice_generator.infrastructure.db.mappers import row_to_sequence, sequence_to_row

_COLUMNS = "company_id, financial_year, prefix, next_sequence, high_water_mark"


class SqliteSequenceRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(
        self,
        company_id: uuid.UUID,
        financial_year: str,
        prefix: str,
    ) -> SequenceState | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM invoice_sequences "
            "WHERE company_id = ? AND financial_year = ? AND prefix = ?",
            (to_canonical(company_id), financial_year, prefix),
        ).fetchone()
        return None if row is None else row_to_sequence(row)

    def save(self, state: SequenceState) -> None:
        row = sequence_to_row(state)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO invoice_sequences ({columns}) VALUES ({placeholders})",
            row,
        )
