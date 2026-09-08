"""SQLite implementation of :class:`InvoiceRepository`.

Persists the invoice header (with totals as INTEGER paise, references and the
finalized snapshot as JSON) and its line items. Participates in the caller's
transaction (DECISIONS D-026): it executes statements on the connection but
never commits. ``list_summaries`` loads header rows only, without line items
(Req 21.3). Parameterized SQL only; UUIDs stored canonically (D-024); no
precision loss (money in paise, D-004).
"""

from __future__ import annotations

import json
import sqlite3
import uuid

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.models import (
    Invoice,
    InvoiceLine,
    InvoiceReferences,
    InvoiceSnapshot,
    InvoiceTotals,
    PlaceOfSupply,
)
from invoice_generator.domain.money import from_paise, to_paise
from invoice_generator.infrastructure.db.mappers import (
    line_to_row,
    parse_invoice_status,
    parse_payment_status,
    parse_uid,
    parse_uid_opt,
    row_to_line,
    uid_opt,
)

_HEADER_COLUMNS = (
    "id, company_id, customer_id, status, payment_status, invoice_number, "
    "invoice_date, place_of_supply_state, place_of_supply_code, template_version, "
    "logo_asset_id, signature_asset_id, payment_terms, due_date, notes, terms, "
    "declaration, total_taxable_paise, total_cgst_paise, total_sgst_paise, "
    "total_igst_paise, raw_total_paise, round_off_paise, grand_total_paise, "
    "snapshot_json, references_json, cancelled_at, cancel_reason, "
    "replacement_invoice_id, created_at, updated_at"
)

_LINE_COLUMNS = (
    "id, invoice_id, sequence, job_or_mould_reference, component_or_part, operation, "
    "description, specification, hsn_sac, quantity_millis, unit, rate_paise, "
    "discount_hundredths, tax_treatment, tax_rate_hundredths, taxable_paise, "
    "cgst_paise, sgst_paise, igst_paise"
)


class SqliteInvoiceRepository:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    # --- read ---

    def get(self, invoice_id: uuid.UUID) -> Invoice | None:
        row = self._conn.execute(
            f"SELECT {_HEADER_COLUMNS} FROM invoices WHERE id = ?",
            (to_canonical(invoice_id),),
        ).fetchone()
        if row is None:
            return None
        line_rows = self._conn.execute(
            f"SELECT {_LINE_COLUMNS} FROM invoice_items WHERE invoice_id = ? ORDER BY sequence",
            (to_canonical(invoice_id),),
        ).fetchall()
        lines = tuple(row_to_line(r) for r in line_rows)
        return self._row_to_invoice(row, lines)

    def list_summaries(self) -> list[Invoice]:
        rows = self._conn.execute(
            f"SELECT {_HEADER_COLUMNS} FROM invoices ORDER BY created_at"
        ).fetchall()
        # Summary-only: no line items loaded (Req 21.3).
        return [self._row_to_invoice(r, ()) for r in rows]

    # --- write ---

    def save(self, invoice: Invoice) -> None:
        header = self._invoice_to_header_row(invoice)
        columns = ", ".join(header)
        placeholders = ", ".join(f":{key}" for key in header)
        # Upsert on the primary key only. Using ON CONFLICT(id) (not
        # INSERT OR REPLACE) ensures a conflict on the unique invoice_number of
        # a *different* row raises IntegrityError instead of silently replacing
        # that other invoice (the numbering backstop, D-028).
        updates = ", ".join(f"{key} = :{key}" for key in header if key != "id")
        self._conn.execute(
            f"INSERT INTO invoices ({columns}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates}",
            header,
        )
        # Replace line items wholesale to keep them in sync with the header.
        self._conn.execute(
            "DELETE FROM invoice_items WHERE invoice_id = ?",
            (to_canonical(invoice.id),),
        )
        for line in invoice.lines:
            line_row = line_to_row(line, invoice.id)
            line_columns = ", ".join(line_row)
            line_placeholders = ", ".join(f":{key}" for key in line_row)
            self._conn.execute(
                f"INSERT INTO invoice_items ({line_columns}) VALUES ({line_placeholders})",
                line_row,
            )

    def delete_draft(self, invoice_id: uuid.UUID) -> None:
        # FK ON DELETE CASCADE removes the line items.
        self._conn.execute(
            "DELETE FROM invoices WHERE id = ? AND status = 'DRAFT'",
            (to_canonical(invoice_id),),
        )

    # --- mapping ---

    def _invoice_to_header_row(self, inv: Invoice) -> dict[str, object]:
        totals = inv.totals
        return {
            "id": to_canonical(inv.id),
            "company_id": uid_opt(inv.company_id),
            "customer_id": uid_opt(inv.customer_id),
            "status": inv.status.value,
            "payment_status": inv.payment_status.value,
            "invoice_number": inv.invoice_number,
            "invoice_date": inv.invoice_date,
            "place_of_supply_state": inv.place_of_supply.state_name,
            "place_of_supply_code": inv.place_of_supply.state_code,
            "template_version": inv.template_version,
            "logo_asset_id": None,
            "signature_asset_id": None,
            "payment_terms": inv.payment_terms,
            "due_date": inv.due_date,
            "notes": inv.notes,
            "terms": inv.terms,
            "declaration": inv.declaration,
            "total_taxable_paise": _paise_or_zero(totals, "total_taxable"),
            "total_cgst_paise": _paise_or_zero(totals, "total_cgst"),
            "total_sgst_paise": _paise_or_zero(totals, "total_sgst"),
            "total_igst_paise": _paise_or_zero(totals, "total_igst"),
            "raw_total_paise": _paise_or_zero(totals, "raw_total"),
            "round_off_paise": _paise_or_zero(totals, "round_off"),
            "grand_total_paise": _paise_or_zero(totals, "grand_total"),
            "snapshot_json": None if inv.snapshot is None else inv.snapshot.model_dump_json(),
            "references_json": inv.references.model_dump_json(),
            "cancelled_at": inv.cancelled_at,
            "cancel_reason": inv.cancel_reason,
            "replacement_invoice_id": uid_opt(inv.replacement_invoice_id),
            "created_at": "",
            "updated_at": "",
        }

    def _row_to_invoice(self, row: sqlite3.Row, lines: tuple[InvoiceLine, ...]) -> Invoice:
        totals = _totals_from_row(row)
        snapshot_json = row["snapshot_json"]
        snapshot = (
            None if snapshot_json is None else InvoiceSnapshot.model_validate_json(snapshot_json)
        )
        references = InvoiceReferences.model_validate(json.loads(row["references_json"]))
        return Invoice(
            id=parse_uid(row["id"]),
            invoice_number=row["invoice_number"],
            status=parse_invoice_status(row["status"]),
            payment_status=parse_payment_status(row["payment_status"]),
            invoice_date=row["invoice_date"],
            company_id=parse_uid_opt(row["company_id"]),
            customer_id=parse_uid_opt(row["customer_id"]),
            place_of_supply=PlaceOfSupply(
                state_name=row["place_of_supply_state"],
                state_code=row["place_of_supply_code"],
            ),
            references=references,
            lines=lines,
            totals=totals,
            payment_terms=row["payment_terms"],
            due_date=row["due_date"],
            notes=row["notes"],
            terms=row["terms"],
            declaration=row["declaration"],
            template_version=row["template_version"],
            snapshot=snapshot,
            cancelled_at=row["cancelled_at"],
            cancel_reason=row["cancel_reason"],
            replacement_invoice_id=parse_uid_opt(row["replacement_invoice_id"]),
        )


def _paise_or_zero(totals: InvoiceTotals | None, attr: str) -> int:
    if totals is None:
        return 0
    return to_paise(getattr(totals, attr))


def _totals_from_row(row: sqlite3.Row) -> InvoiceTotals | None:
    # A draft with no computed totals stores all-zero paise and no snapshot.
    if row["status"] == "DRAFT" and row["snapshot_json"] is None and row["grand_total_paise"] == 0:
        return None
    return InvoiceTotals(
        total_taxable=from_paise(int(row["total_taxable_paise"])),
        total_cgst=from_paise(int(row["total_cgst_paise"])),
        total_sgst=from_paise(int(row["total_sgst_paise"])),
        total_igst=from_paise(int(row["total_igst_paise"])),
        raw_total=from_paise(int(row["raw_total_paise"])),
        round_off=from_paise(int(row["round_off_paise"])),
        grand_total=from_paise(int(row["grand_total_paise"])),
    )
