"""Integration tests for the composition root (Task 43)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from invoice_generator.application.clock import FixedClock
from invoice_generator.bootstrap import Application, build_application
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from tests.support.build_test_app import build_test_app
from tests.support.id_factory import SequentialIdGenerator


def test_build_application_wires_and_migrates(tmp_path: Path) -> None:
    app = build_application(tmp_path / "invoices.db")
    try:
        assert isinstance(app, Application)
        # Migrations applied: core tables exist.
        tables = {
            r["name"]
            for r in app.connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        assert {"invoices", "invoice_items", "companies", "schema_version"}.issubset(tables)
    finally:
        app.close()


def test_end_to_end_use_case_through_root(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        # Seed masters through the wired repositories.
        company = Company(
            name="Suntech Enterprises",
            address=Address(state_name="Maharashtra", state_code="27"),
        )
        customer = Customer(
            name="DI-TECH MOULDS",
            bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code="27"),
        )
        app.company_service_repo.save(company)
        app.customer_service_repo.save(customer)

        # Draft -> finalize through the invoice service.
        draft = app.invoice_service.create_draft(
            Invoice(
                customer_id=customer.id,
                place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
                lines=(
                    InvoiceLine(
                        description="Gundrilling",
                        hsn_sac="998898",
                        quantity=Decimal("16"),
                        unit="NOS",
                        rate=Decimal("767.50"),
                        tax_rate=Decimal("18"),
                    ),
                ),
            )
        )
        finalized = app.invoice_service.finalize(
            draft.id, invoice_date=datetime(2026, 5, 11).date()
        )

        assert finalized.status is InvoiceStatus.FINALIZED
        assert finalized.invoice_number == "SE/26-27/001"
        assert finalized.totals is not None
        assert finalized.totals.grand_total == Decimal("14490.00")

        # PDF renders through the wired PDF service.
        dto = app.pdf_service.build_dto(finalized)
        assert dto.totals.grand_total == "14,490.00"
    finally:
        app.close()


def test_injected_id_generator_used(tmp_path: Path) -> None:
    app = build_application(
        tmp_path / "invoices.db",
        id_generator=SequentialIdGenerator(start=1),
        clock=FixedClock(datetime(2026, 5, 11, tzinfo=UTC)),
    )
    try:
        draft = app.invoice_service.create_draft()
        assert str(draft.id) == "00000000-0000-4000-8000-000000000001"
    finally:
        app.close()


def test_injected_clock_used_for_cancellation(tmp_path: Path) -> None:
    fixed = datetime(2026, 7, 1, 10, 30, tzinfo=UTC)
    app = build_application(
        tmp_path / "invoices.db",
        id_generator=SequentialIdGenerator(start=1),
        clock=FixedClock(fixed),
    )
    try:
        company = Company(
            name="Suntech", address=Address(state_name="Maharashtra", state_code="27")
        )
        customer = Customer(
            name="Cust", bill_to=Address(line="x", state_name="Maharashtra", state_code="27")
        )
        app.company_service_repo.save(company)
        app.customer_service_repo.save(customer)
        draft = app.invoice_service.create_draft(
            Invoice(
                customer_id=customer.id,
                place_of_supply=PlaceOfSupply(state_name="Maharashtra", state_code="27"),
                lines=(
                    InvoiceLine(
                        description="x", hsn_sac="998898", quantity=Decimal("1"), rate=Decimal("1")
                    ),
                ),
            )
        )
        finalized = app.invoice_service.finalize(
            draft.id, invoice_date=datetime(2026, 5, 11).date()
        )
        # cancel without an explicit 'when' uses the injected clock.
        cancelled = app.invoice_service.cancel(finalized.id, "correction")
        assert cancelled.status is InvoiceStatus.CANCELLED
        assert cancelled.cancelled_at == fixed.isoformat()
    finally:
        app.close()


def test_payment_status_through_root(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        company = Company(name="Suntech", address=Address(state_name="MH", state_code="27"))
        customer = Customer(name="C", bill_to=Address(line="x", state_name="MH", state_code="27"))
        app.company_service_repo.save(company)
        app.customer_service_repo.save(customer)
        draft = app.invoice_service.create_draft(
            Invoice(
                customer_id=customer.id,
                place_of_supply=PlaceOfSupply(state_name="MH", state_code="27"),
                lines=(
                    InvoiceLine(
                        description="x", hsn_sac="998898", quantity=Decimal("1"), rate=Decimal("1")
                    ),
                ),
            )
        )
        finalized = app.invoice_service.finalize(
            draft.id, invoice_date=datetime(2026, 5, 11).date()
        )
        updated = app.invoice_service.set_payment_status(finalized.id, PaymentStatus.PAID)
        assert updated.payment_status is PaymentStatus.PAID
    finally:
        app.close()


def test_no_module_level_global_state() -> None:
    # The composition root exposes only the builder + container, no global
    # mutable singleton/container (DECISIONS D-021).
    import invoice_generator.bootstrap as boot

    assert set(boot.__all__) == {"Application", "build_application"}
