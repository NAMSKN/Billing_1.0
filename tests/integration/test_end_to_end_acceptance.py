"""Automated end-to-end acceptance (Task 62).

Drives the full workflow through the real wired application —
create -> finalize -> PDF -> print -> backup -> restore -> reprint — and asserts
the acceptance criteria that are checkable headlessly: a valid A4 PDF, required
content present, the Invoice 043 golden aggregate values reproduced, the print
pipeline spooling a valid PDF, and reprint after restore reproducing identical
content (not a new invoice). The physical printed-A4 check is manual and is
documented in docs/ACCEPTANCE_E2E.md.

References: requirements Req 19, 20, 26; PDF_LAYOUT §40, §45; DECISIONS D-031.
"""

from __future__ import annotations

import io
import re
from datetime import date
from decimal import Decimal
from pathlib import Path

from pypdf import PdfReader

from invoice_generator.bootstrap import Application
from invoice_generator.domain.models import (
    Address,
    Company,
    Customer,
    Invoice,
    InvoiceLine,
    PlaceOfSupply,
)
from invoice_generator.infrastructure.backup.manifest import create_package
from invoice_generator.infrastructure.backup.restore import (
    reconcile_after_restore,
    restore_backup,
)
from tests.support.build_test_app import build_test_app

INVOICE_DATE = date(2026, 5, 11)
A4_WIDTH_PT = 595.2756
A4_HEIGHT_PT = 841.8898

# Invoice 043 golden aggregate values (testing rules; PDF_LAYOUT §34).
GOLDEN_TAXABLE = "12,280.00"
GOLDEN_CGST = "1,105.20"
GOLDEN_SGST = "1,105.20"
GOLDEN_GRAND_TOTAL = "14,490.00"


class _CapturingPrintPort:
    """Fake print port: records the spooled file instead of printing."""

    def __init__(self) -> None:
        self.printed: list[str] = []

    def print_file(self, path: str) -> None:
        self.printed.append(path)


def _seed_and_finalize(app: Application) -> Invoice:
    app.company_service_repo.save(
        Company(
            name="SUNTECH ENTERPRISES",
            address=Address(state_name="Maharashtra", state_code="27"),
        )
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
                    job_or_mould_reference="DT-663",
                    operation="PUNCH GUN DRILLING",
                    description="Service Charges (Gundrilling)",
                    specification="DRILL DIA 9X307MM DEEP",
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
    return "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)


def test_end_to_end_workflow(tmp_path: Path) -> None:
    app = build_test_app(tmp_path)
    printed_paths: list[str] = []
    try:
        # 1. Create + finalize.
        finalized = _seed_and_finalize(app)
        assert finalized.invoice_number == "SE/26-27/001"

        # 2. PDF: valid, A4, required content, golden values.
        pdf = app.pdf_service.render(finalized)
        assert pdf.startswith(b"%PDF-")
        assert pdf.rstrip().endswith(b"%%EOF")
        m = re.search(rb"MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", pdf)
        assert m is not None
        assert abs(float(m.group(1)) - A4_WIDTH_PT) < 0.5
        assert abs(float(m.group(2)) - A4_HEIGHT_PT) < 0.5

        text = _text(pdf)
        assert "TAX INVOICE" in text
        assert "SE/26-27/001" in text
        assert "DI-TECH MOULDS" in text
        assert GOLDEN_TAXABLE in text
        assert GOLDEN_CGST in text
        assert GOLDEN_SGST in text
        assert GOLDEN_GRAND_TOTAL in text

        # 3. Export to disk.
        exported = app.pdf_service.export(finalized, tmp_path / "invoice.pdf")
        assert Path(exported).exists()

        # 4. Print: pipeline spools a valid A4 PDF (via a fake port).
        port = _CapturingPrintPort()
        from invoice_generator.application.print_service import PrintService

        print_service = PrintService(app.pdf_service, print_port=port)
        spooled = print_service.print_invoice(finalized, tmp_path / "spool")
        assert spooled.exists()
        assert len(port.printed) == 1
        spooled_bytes = Path(port.printed[0]).read_bytes()
        assert spooled_bytes.startswith(b"%PDF-")

        reprint_source_text = _text(pdf)
        printed_paths.append(str(exported))
    finally:
        app.close()

    # 5. Backup the finalized state.
    source_db = tmp_path / "invoices.db"
    package = create_package(
        source_db=source_db,
        schema_version=1,
        app_version="0.1.0",
        destination=tmp_path / "backups" / "backup.zip",
        created_at="2026-05-11T09:00:00+00:00",
    )

    # 6. Restore + reconcile.
    restore_backup(package, database=source_db, safety_backup_dir=tmp_path / "safety")

    reopened = build_test_app(tmp_path)
    try:
        reconcile_after_restore(reopened.connection, reopened.numbering_service, source_db)

        # 7. Reprint after restore: same invoice, identical rendered content
        #    (no new invoice, no recalculated values — D-031).
        summaries = list(reopened.invoice_service.list_summaries())
        assert len(summaries) == 1
        restored = reopened.invoice_service.get(summaries[0].id)
        assert restored is not None
        assert restored.invoice_number == "SE/26-27/001"

        reprint = reopened.pdf_service.render(restored)
        assert _text(reprint) == reprint_source_text  # identical content on reprint
    finally:
        reopened.close()
