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
from decimal import Decimal

from invoice_generator.bootstrap import Application
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
from invoice_generator.ui.invoices.invoice_list_controller import (
    InvoiceFilter,
    InvoiceListController,
    InvoiceRow,
)

_DEFAULT_RECENT = 10
_ZERO = Decimal("0.00")


@dataclass(frozen=True)
class DashboardCounts:
    """Per-status invoice counts for the dashboard summary."""

    total: int
    draft: int
    finalized: int
    cancelled: int


@dataclass(frozen=True)
class DashboardMetrics:
    """Operational metrics for the dashboard, computed from persisted data.

    Billing totals aggregate ONLY finalized, non-cancelled invoices (drafts and
    cancelled invoices are excluded). Payment status is independent of lifecycle
    (DECISIONS D-015): ``pending_payment`` counts finalized, non-cancelled
    invoices whose payment status is not PAID. Values come from stored invoice
    totals; nothing is recalculated in the presentation layer.
    """

    total: int
    draft: int
    finalized: int
    cancelled: int
    pending_payment: int
    finalized_taxable: Decimal
    finalized_tax: Decimal
    finalized_grand_total: Decimal


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

    def company_missing(self) -> bool:
        """True if no active company with a name is configured (a warning)."""
        company = self._app.company_service_repo.get_active()
        return company is None or not company.name.strip()

    def metrics(self) -> DashboardMetrics:
        """Aggregate operational metrics from persisted invoice summaries.

        Billing totals use only finalized, non-cancelled invoices (drafts and
        cancelled excluded). ``pending_payment`` counts finalized, non-cancelled
        invoices not marked PAID. Uses stored totals; no business recalculation.
        """
        invoices = list(self._app.invoice_service.list_summaries())
        draft = finalized = cancelled = pending = 0
        taxable = tax = grand = _ZERO
        for inv in invoices:
            if inv.status is InvoiceStatus.DRAFT:
                draft += 1
            elif inv.status is InvoiceStatus.CANCELLED:
                cancelled += 1
            elif inv.status is InvoiceStatus.FINALIZED:
                finalized += 1
                if inv.payment_status is not PaymentStatus.PAID:
                    pending += 1
                if inv.totals is not None:
                    taxable += inv.totals.total_taxable
                    tax += inv.totals.total_cgst + inv.totals.total_sgst + inv.totals.total_igst
                    grand += inv.totals.grand_total
        return DashboardMetrics(
            total=len(invoices),
            draft=draft,
            finalized=finalized,
            cancelled=cancelled,
            pending_payment=pending,
            finalized_taxable=taxable,
            finalized_tax=tax,
            finalized_grand_total=grand,
        )


__all__ = ["DashboardController", "DashboardCounts", "DashboardMetrics"]
