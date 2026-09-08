"""SQLite implementation of :class:`CustomerRepository`.

Participates in the caller's transaction (DECISIONS D-026). Parameterized SQL.
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import Customer
from invoice_generator.infrastructure.db.mappers import customer_to_row, row_to_customer

_COLUMNS = (
    "id, name, gstin, phone, email, bill_line, bill_state_name, bill_state_code, "
    "bill_godown, ship_line, ship_state_name, ship_state_code, ship_godown, is_active"
)


class SqliteCustomerRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, customer_id: uuid.UUID) -> Customer | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM customers WHERE id = ?",
            (to_canonical(customer_id),),
        ).fetchone()
        return None if row is None else row_to_customer(row)

    def save(self, customer: Customer) -> None:
        row = customer_to_row(customer)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO customers ({columns}) VALUES ({placeholders})",
            row,
        )

    def list_active(self) -> Sequence[Customer]:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM customers WHERE is_active = 1 ORDER BY name"
        ).fetchall()
        return [row_to_customer(r) for r in rows]
