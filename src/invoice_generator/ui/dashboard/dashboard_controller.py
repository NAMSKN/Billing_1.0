"""Dashboard controller (Task 51).

Provides the dashboard's read-only summary data — recent invoices, per-status
counts, and a quick search — by delegating to the invoice services (no SQL or
calculations in the UI — DECISIONS D-021). Recent/search rows reuse the invoice
history controller's row model and summary-only loading (Req 21.3), so the
dashboard and history stay consistent.

References: requirements Req 25.1; DECISIONS D-021.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from invoice_generator.bootstrap import Application
from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.ui.invoices.invoice_list_controller import (
    InvoiceFilter,
    InvoiceListController,
    InvoiceRow,
)

_DEFAULT_RECENT = 10


@dataclass(frozen=True)
class DashboardCounts:
    """Per-status invoice counts for the dashboard summary."""

    total: int
    draft: int
    finalized: int
    cancelled: int


class DashboardController:
    def __init__(self, app: Application) -> None:
        self._app = app
        self._list = InvoiceListController(app)

    def recent_invoices(self, limit: int = _DEFAULT_RECENT) -> Sequence[InvoiceRow]:
        """Return the most recent invoices (by date desc), newest first."""
        rows = list(self._list.list_rows())
        rows.sort(key=lambda r: r.date, reverse=True)
        return rows[:limit]

    def quick_search(self, query: str) -> Sequence[InvoiceRow]:
        """Search invoices by number or customer (reuses the history filter)."""
        text = query.strip()
        if not text:
            return self.recent_invoices()
        by_number = self._list.list_rows(InvoiceFilter(number_query=text))
        by_customer = self._list.list_rows(InvoiceFilter(customer_query=text))
        # Merge, de-duplicating by invoice id while preserving order.
        seen: set[str] = set()
        merged: list[InvoiceRow] = []
        for row in (*by_number, *by_customer):
            key = str(row.invoice_id)
            if key not in seen:
                seen.add(key)
                merged.append(row)
        return merged

    def counts(self) -> DashboardCounts:
        """Return invoice counts by lifecycle status."""
        invoices = list(self._app.invoice_service.list_summaries())
        draft = sum(1 for i in invoices if i.status is InvoiceStatus.DRAFT)
        finalized = sum(1 for i in invoices if i.status is InvoiceStatus.FINALIZED)
        cancelled = sum(1 for i in invoices if i.status is InvoiceStatus.CANCELLED)
        return DashboardCounts(
            total=len(invoices),
            draft=draft,
            finalized=finalized,
            cancelled=cancelled,
        )


__all__ = ["DashboardController", "DashboardCounts"]
