"""SQLite implementation of PartyRepository."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Optional, Sequence

from common.domain.address import Address
from vendor_customer.domain.models import BankDetails, Party, PartyRole
from vendor_customer.domain.repositories import PartyRepository


class SqlitePartyRepository(PartyRepository):
    """SQLite implementation of PartyRepository."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn
        self._ensure_table()

    def _ensure_table(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS parties (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                legal_name TEXT DEFAULT '',
                role TEXT NOT NULL,
                gstin TEXT DEFAULT '',
                pan TEXT DEFAULT '',
                contact_person TEXT DEFAULT '',
                phone TEXT DEFAULT '',
                email TEXT DEFAULT '',
                billing_line TEXT DEFAULT '',
                billing_state TEXT DEFAULT '',
                billing_state_code TEXT DEFAULT '',
                shipping_line TEXT DEFAULT '',
                bank_name TEXT DEFAULT '',
                bank_account TEXT DEFAULT '',
                bank_ifsc TEXT DEFAULT '',
                credit_days INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1
            )
            """
        )

    def get_by_id(self, party_id: uuid.UUID) -> Optional[Party]:
        cur = self._conn.execute(
            "SELECT * FROM parties WHERE id = ?", (str(party_id),)
        )
        row = cur.fetchone()
        return self._to_party(row) if row else None

    def get_by_gstin(self, gstin: str) -> Optional[Party]:
        cur = self._conn.execute(
            "SELECT * FROM parties WHERE gstin = ? AND is_active = 1",
            (gstin.strip().upper(),),
        )
        row = cur.fetchone()
        return self._to_party(row) if row else None

    def list_all(
        self, role: Optional[PartyRole] = None, include_inactive: bool = False
    ) -> Sequence[Party]:
        query = "SELECT * FROM parties WHERE 1=1"
        params: list[object] = []

        if not include_inactive:
            query += " AND is_active = 1"

        if role:
            query += " AND (role = ? OR role = 'BOTH')"
            params.append(role.value)

        query += " ORDER BY display_name ASC"
        rows = self._conn.execute(query, params).fetchall()
        return [self._to_party(r) for r in rows]

    def save(self, party: Party) -> None:
        bank_name = party.bank_details.bank_name if party.bank_details else ""
        bank_account = party.bank_details.account_number if party.bank_details else ""
        bank_ifsc = party.bank_details.ifsc_code if party.bank_details else ""
        shipping_line = party.shipping_address.line if party.shipping_address else ""

        self._conn.execute(
            """
            INSERT INTO parties (
                id, display_name, legal_name, role, gstin, pan, contact_person,
                phone, email, billing_line, billing_state, billing_state_code,
                shipping_line, bank_name, bank_account, bank_ifsc, credit_days, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                display_name=excluded.display_name,
                legal_name=excluded.legal_name,
                role=excluded.role,
                gstin=excluded.gstin,
                pan=excluded.pan,
                contact_person=excluded.contact_person,
                phone=excluded.phone,
                email=excluded.email,
                billing_line=excluded.billing_line,
                billing_state=excluded.billing_state,
                billing_state_code=excluded.billing_state_code,
                shipping_line=excluded.shipping_line,
                bank_name=excluded.bank_name,
                bank_account=excluded.bank_account,
                bank_ifsc=excluded.bank_ifsc,
                credit_days=excluded.credit_days,
                is_active=excluded.is_active
            """,
            (
                str(party.id),
                party.display_name,
                party.legal_name,
                party.role.value,
                party.gstin,
                party.pan,
                party.contact_person,
                party.phone,
                party.email,
                party.billing_address.line,
                party.billing_address.state,
                party.billing_address.state_code,
                shipping_line,
                bank_name,
                bank_account,
                bank_ifsc,
                party.credit_days,
                1 if party.is_active else 0,
            ),
        )

    def archive(self, party_id: uuid.UUID) -> bool:
        cur = self._conn.execute(
            "UPDATE parties SET is_active = 0 WHERE id = ?", (str(party_id),)
        )
        return cur.rowcount > 0

    def _to_party(self, row: tuple) -> Party:
        # Columns mapped by position from SELECT *
        return Party(
            id=uuid.UUID(row[0]),
            display_name=row[1],
            legal_name=row[2],
            role=PartyRole(row[3]),
            gstin=row[4],
            pan=row[5],
            contact_person=row[6],
            phone=row[7],
            email=row[8],
            billing_address=Address(
                line=row[9],
                state=row[10],
                state_code=row[11],
            ),
            shipping_address=Address(line=row[12]) if row[12] else None,
            bank_details=BankDetails(
                bank_name=row[13],
                account_number=row[14],
                ifsc_code=row[15],
            )
            if row[13] or row[14] or row[15]
            else None,
            credit_days=row[16],
            is_active=bool(row[17]),
        )
