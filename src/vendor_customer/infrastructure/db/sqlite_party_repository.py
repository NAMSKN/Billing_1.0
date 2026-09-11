"""SQLite implementation of :class:`PartyRepository`.

Uses the schema created by migration ``0003_parties.sql`` (never creates tables
ad hoc). Parameterized SQL only. Participates in the caller's transaction and
never begins/commits its own (DECISIONS D-026).
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from vendor_customer.domain.models import Party, PartyType
from vendor_customer.domain.rules import normalize_company_name
from vendor_customer.infrastructure.db.mappers import party_to_row, row_to_party

_COLUMNS = (
    "id, company_type, company_name, contact_person, contact_no, email, "
    "registration_type, gstin, pan, "
    "bill_address1, bill_address2, bill_landmark, bill_country, bill_state, "
    "bill_state_code, bill_city, bill_pincode, "
    "has_shipping, ship_address1, ship_address2, ship_landmark, ship_country, "
    "ship_state, ship_state_code, ship_city, ship_pincode, "
    "distance_for_eway_bill_km, group_id, "
    "bank_name, bank_ifsc_code, bank_account_number, "
    "fax_no, website, credit_limit_paise, due_days, note, visible_on_documents, "
    "custom_field_1, custom_field_2, custom_field_3, "
    "customer_balance_type, customer_balance_paise, "
    "vendor_balance_type, vendor_balance_paise, "
    "is_active, created_at, updated_at"
)


class SqlitePartyRepository:
    """SQLite-backed party repository."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def get(self, party_id: uuid.UUID) -> Party | None:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM parties WHERE id = ?",
            (to_canonical(party_id),),
        ).fetchone()
        return None if row is None else row_to_party(row)

    def get_by_gstin(self, gstin: str) -> Party | None:
        clean = gstin.strip().upper()
        if not clean:
            return None
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM parties WHERE gstin = ? ORDER BY is_active DESC LIMIT 1",
            (clean,),
        ).fetchone()
        return None if row is None else row_to_party(row)

    def find_by_name_and_phone(self, company_name: str, contact_no: str) -> Party | None:
        key = normalize_company_name(company_name)
        phone = contact_no.strip()
        if not key or not phone:
            return None
        for row in self._conn.execute(
            f"SELECT {_COLUMNS} FROM parties WHERE contact_no = ?",
            (phone,),
        ).fetchall():
            party = row_to_party(row)
            if normalize_company_name(party.company_name) == key:
                return party
        return None

    def list_all(
        self,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        query = f"SELECT {_COLUMNS} FROM parties WHERE 1 = 1"
        params: list[object] = []
        if not include_archived:
            query += " AND is_active = 1"
        if party_type is PartyType.CUSTOMER:
            query += " AND company_type IN ('CUSTOMER', 'CUSTOMER_VENDOR')"
        elif party_type is PartyType.VENDOR:
            query += " AND company_type IN ('VENDOR', 'CUSTOMER_VENDOR')"
        elif party_type is PartyType.CUSTOMER_VENDOR:
            query += " AND company_type = 'CUSTOMER_VENDOR'"
        query += " ORDER BY company_name COLLATE NOCASE ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [row_to_party(r) for r in rows]

    def save(self, party: Party) -> None:
        row = party_to_row(party)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO parties ({columns}) VALUES ({placeholders})",
            row,
        )

    def archive(self, party_id: uuid.UUID) -> bool:
        cur = self._conn.execute(
            "UPDATE parties SET is_active = 0 WHERE id = ?",
            (to_canonical(party_id),),
        )
        return cur.rowcount > 0
