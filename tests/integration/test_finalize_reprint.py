"""Tests for the finalize / reprint workflow (Task 49)."""

from __future__ import annotations

import io
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from pypdf import PdfReader

from invoice_generator.application.pdf_service import PdfService
from invoice_generator.application.print_service import PrintService
from invoice_generator.bootstrap import Application
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from tests.support.build_test_app import build_test_app

INVOICE_DATE = date(2026, 5, 11)


def _finalize(app: Application) -> Invoice:
    app.company_service_repo.save(
        Company(name="Suntech", address=Address(state_name="Maharashtra", state_code="27"))
    )
    customer = Customer(
        name="DI-TECH MOULDS",
        bill_to=Address(line="Plot 9", state_name="Maharashtra", state_code="27"),
    )
    app.customer_service_repo.save(customer)
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
    return app.invoice_service.finalize(draft.id, invoice_date=INVOICE_DATE)


def _text(pdf: bytes) -> str:
    return "".join(p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages)


# --- deterministic filename ---


def test_export_filename_deterministic() -> None:
    assert PdfService.export_filename("SE/26-27/043") == "INV_SE_26-27_043.pdf"
    assert PdfService.export_filename("SE/26-27/001") == "INV_SE_26-27_001.pdf"


# --- one rendering path: preview == export == reprint (content) ---


def test_preview_export_reprint_content_equivalent(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        preview = app.pdf_service.render(invoice)
        out = tmp_path / app.pdf_service.export_filename(invoice.invoice_number or "")
        app.pdf_service.export(invoice, out)
        exported = out.read_bytes()
        reprint = app.pdf_service.render(invoice)  # render again = reprint

        # Content-equivalent (extracted text), not necessarily byte-identical (D-031).
        assert _text(preview) == _text(exported) == _text(reprint)
        assert "14,490.00" in _text(preview)
        assert invoice.invoice_number in _text(preview)
    finally:
        app.close()


def test_export_writes_file_with_deterministic_name(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        name = app.pdf_service.export_filename(invoice.invoice_number or "")
        path = app.pdf_service.export(invoice, tmp_path / name)
        assert path.name == "INV_SE_26-27_001.pdf"
        assert path.read_bytes().startswith(b"%PDF-")
    finally:
        app.close()


# --- reprint uses snapshot (authority) ---


def test_reprint_uses_snapshot_after_master_change(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        # Corrupt the live masters; reprint must still show the snapshot values.
        app.connection.execute("UPDATE companies SET name='GARBAGE'")
        app.connection.execute("UPDATE customers SET name='GARBAGE'")
        text = _text(app.pdf_service.render(invoice))
        assert "DI-TECH MOULDS" in text
        assert "Suntech" in text
        assert "GARBAGE" not in text
    finally:
        app.close()


# --- export failure does not modify the invoice ---


def test_export_failure_leaves_invoice_and_no_file(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        # A draft (no snapshot) cannot be rendered -> export raises before writing.
        draft = app.invoice_service.create_draft()
        target = tmp_path / "should_not_exist.pdf"
        with pytest.raises(ValueError):
            app.pdf_service.export(draft, target)
        assert not target.exists()  # no corrupt/partial file left
        # The finalized invoice is untouched.
        reloaded = app.invoice_service.get(invoice.id)
        assert reloaded is not None
        assert reloaded.invoice_number == invoice.invoice_number
    finally:
        app.close()


# --- number issued only on commit / reprint keeps it ---


def test_finalize_issues_number_and_reprint_keeps_it(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        assert invoice.invoice_number == "SE/26-27/001"
        text1 = _text(app.pdf_service.render(invoice))
        text2 = _text(app.pdf_service.render(invoice))
        assert "SE/26-27/001" in text1
        assert text1 == text2  # reprint does not change values
    finally:
        app.close()


# --- printing via injected port (no real spool) ---


def test_print_renders_and_calls_port(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    try:
        invoice = _finalize(app)
        printed: list[str] = []

        class _FakePort:
            def print_file(self, path: str) -> None:
                printed.append(path)

        service = PrintService(app.pdf_service, print_port=_FakePort())
        spooled = service.print_invoice(invoice, tmp_path / "spool")
        assert spooled.exists()
        assert spooled.read_bytes().startswith(b"%PDF-")
        assert printed == [str(spooled)]
    finally:
        app.close()


def test_shell_print_adapter_conforms_to_port() -> None:
    from invoice_generator.application.print_service import PrintPort, ShellPrintAdapter

    assert isinstance(ShellPrintAdapter(), PrintPort)
