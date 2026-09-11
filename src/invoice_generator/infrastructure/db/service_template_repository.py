"""SQLite implementation of :class:`ServiceTemplateRepository` (Req 29, P2).

Participates in the caller's transaction (DECISIONS D-026). Parameterized SQL.
Stores only descriptive fields — no price, quantity, or stock — so templates
never become an inventory feature (Req 29.3).
"""

from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Sequence

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import ServiceTemplate
from invoice_generator.infrastructure.db.mappers import (
    row_to_service_template,
    service_template_to_row,
)

_COLUMNS = "id, company_id, name, description, hsn_sac, unit"


class SqliteServiceTemplateRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def save(self, template: ServiceTemplate) -> None:
        row = service_template_to_row(template)
        columns = ", ".join(row)
        placeholders = ", ".join(f":{key}" for key in row)
        self._conn.execute(
            f"INSERT OR REPLACE INTO service_templates ({columns}) VALUES ({placeholders})",
            row,
        )

    def list(self) -> Sequence[ServiceTemplate]:
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM service_templates ORDER BY name"
        ).fetchall()
        return [row_to_service_template(row) for row in rows]

    def delete(self, template_id: uuid.UUID) -> None:
        self._conn.execute(
            "DELETE FROM service_templates WHERE id = ?",
            (to_canonical(template_id),),
        )
