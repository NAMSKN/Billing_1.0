"""SQLite implementation of :class:`CompanyRepository`.

Participates in the caller's transaction (DECISIONS D-026): it executes
statements on the given connection but does not commit. Parameterized SQL only.
"""

from __future__ import annotations

import sqlite3
import uuid

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import Company
from invoice_generator.infrastructure.db.mappers import company_to_row, row_to_company

_COLUMNS = (
    "id, name, address_line, state_name, state_code, gstin, email, phone, "
    "bank_name, account_number, branch, ifsc, upi_id, authorized_signatory, "
    "logo_asset_id, signature_asset_id, active"
)


class SqliteCompanyRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, company_id: uuid.UUID) -> Company | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM companies WHERE id = ?",
            (to_canonical(company_id),),
        ).fetchone()
        return None if row is None else row_to_company(row)

    def get_active(self) -> Company | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM companies WHERE active = 1 LIMIT 1"
        ).fetchone()
        return None if row is None else row_to_company(row)

    def save(self, company: Company) -> None:
        row = company_to_row(company)
        placeholders = ", ".join(f":{key}" for key in row)
        columns = ", ".join(row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO companies ({columns}) VALUES ({placeholders})",
            row,
        )
