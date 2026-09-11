"""Invoice history controller (Task 50).

Provides the invoice list with summary-only loading and in-memory filtering,
plus the row actions (preview/export/print/duplicate/cancel), all via the wired
services (no SQL/calculations in the UI — DECISIONS D-021). Summaries are loaded
without line items (Req 21.3); display fields come from the finalized snapshot
where available.

References: requirements Req 21; DECISIONS D-011, D-021.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from invoice_generator.application.render_dto import format_money
from invoice_generator.bootstrap import Application
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
from invoice_generator.domain.models import Invoice


@dataclass(frozen=True)
class InvoiceFilter:
    """Filter criteria for the invoice history list (all optional)."""

    number_query: str = ""
    customer_query: str = ""
    date_from: date | None = None
    date_to: date | None = None
    status: InvoiceStatus | None = None
    payment_status: PaymentStatus | None = None


@dataclass(frozen=True)
class InvoiceRow:
    """A display row for the history table (no UUID column; id kept internally)."""

    invoice_id: uuid.UUID
    number: str
    date: str
    customer: str
    job_or_mould: str
    total: str
    status: str
    payment_status: str


class InvoiceListController:
    def __init__(self, app: Application) -> None:
        self._app = app

    def list_rows(self, criteria: InvoiceFilter | None = None) -> Sequence[InvoiceRow]:
        """Return filtered display rows built from invoice summaries (Req 21)."""
        criteria = criteria or InvoiceFilter()
        rows: list[InvoiceRow] = []
        for invoice in self._app.invoice_service.list_summaries():
            if not self._matches(invoice, criteria):
                continue
            rows.append(self._to_row(invoice))
        return rows

    def get(self, invoice_id: uuid.UUID) -> Invoice | None:
        return self._app.invoice_service.get(invoice_id)

    # --- filtering ---

    def _matches(self, invoice: Invoice, f: InvoiceFilter) -> bool:
        if f.number_query and f.number_query.lower() not in (invoice.invoice_number or "").lower():
            return False
        if f.customer_query:
            name = self._customer_name(invoice).lower()
            if f.customer_query.lower() not in name:
                return False
        if f.status is not None and invoice.status is not f.status:
            return False
        if f.payment_status is not None and invoice.payment_status is not f.payment_status:
            return False
        if f.date_from is not None or f.date_to is not None:
            parsed = _parse_date(invoice.invoice_date)
            if parsed is None:
                return False
            if f.date_from is not None and parsed < f.date_from:
                return False
            if f.date_to is not None and parsed > f.date_to:
                return False
        return True

    # --- row building ---

    def _to_row(self, invoice: Invoice) -> InvoiceRow:
        total = format_money(invoice.totals.grand_total) if invoice.totals is not None else ""
        return InvoiceRow(
            invoice_id=invoice.id,
            number=invoice.invoice_number or "(draft)",
            date=invoice.invoice_date,
            customer=self._customer_name(invoice),
            job_or_mould=self._job_ref(invoice),
            total=total,
            status=invoice.status.value,
            payment_status=invoice.payment_status.value,
        )

    def _customer_name(self, invoice: Invoice) -> str:
        if invoice.snapshot is not None:
            return invoice.snapshot.customer.name
        if invoice.customer_id is not None:
            customer = self._app.customer_service_repo.get(invoice.customer_id)
            if customer is not None:
                return customer.name
        return ""

    def _job_ref(self, invoice: Invoice) -> str:
        if invoice.snapshot is not None and invoice.snapshot.lines:
            return invoice.snapshot.lines[0].job_or_mould_reference
        if invoice.lines:
            return invoice.lines[0].job_or_mould_reference
        return ""

    # --- actions ---

    def preview_bytes(self, invoice_id: uuid.UUID) -> bytes:
        invoice = self._require(invoice_id)
        return self._app.pdf_service.render(invoice)

    def export(self, invoice_id: uuid.UUID, output_path: str) -> str:
        invoice = self._require(invoice_id)
        return str(self._app.pdf_service.export(invoice, output_path))

    def print(self, invoice_id: uuid.UUID, spool_dir: str) -> str:
        invoice = self._require(invoice_id)
        return str(self._app.print_service.print_invoice(invoice, Path(spool_dir)))

    def duplicate(self, invoice_id: uuid.UUID) -> Invoice:
        return self._app.invoice_service.duplicate(invoice_id)

    def cancel(
        self, invoice_id: uuid.UUID, reason: str, *, when: datetime | None = None
    ) -> Invoice:
        return self._app.invoice_service.cancel(invoice_id, reason, when=when)

    def set_payment_status(self, invoice_id: uuid.UUID, status: PaymentStatus) -> Invoice:
        """Set the payment status (independent of lifecycle; DECISIONS D-015)."""
        return self._app.invoice_service.set_payment_status(invoice_id, status)

    def _require(self, invoice_id: uuid.UUID) -> Invoice:
        invoice = self._app.invoice_service.get(invoice_id)
        if invoice is None:
            raise ValueError("invoice not found")
        return invoice


def _parse_date(text: str) -> date | None:
    try:
        return date.fromisoformat(text)
    except (ValueError, TypeError):
        return None


__all__ = ["InvoiceFilter", "InvoiceListController", "InvoiceRow"]
