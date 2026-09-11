"""Create/Edit invoice form controller (Task 48).

Holds the invoice-form use-case logic behind the PySide6 widget so the widget
stays thin (no SQL, no calculations — DECISIONS D-021). It manages a working
draft, populates parties from the selected customer (Req 3, 22-reuse), exposes
an explicit Place of Supply that defaults from the customer but is overridable
(Req 11), computes **live preview totals** through the single calculation
engine as lines change (Req 7), and performs Save Draft (permissive) vs
Finalize (strict) via the invoice service (Req 8, 9).

The preview totals are display-only; the authoritative finalized totals are
computed by the invoice service inside the finalization transaction.

References: requirements Req 3, 4, 6, 7, 8, 9, 11; DECISIONS D-006, D-021.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import date
from decimal import Decimal
from pathlib import Path

from invoice_generator.application.errors import FinalizationError
from invoice_generator.bootstrap import Application
from invoice_generator.domain.calculation import (
    TaxLineInput,
    calculate_invoice_totals,
    calculate_line,
    calculate_line_tax,
    determine_tax_type,
)
from invoice_generator.domain.enums import TaxTreatment, TaxType
from invoice_generator.domain.models import (
    Customer,
    Invoice,
    InvoiceLine,
    InvoiceTotals,
    PlaceOfSupply,
    TaxRateConfig,
)
from invoice_generator.domain.validation import ValidationResult

_ZERO = Decimal("0.00")
_ZERO_TOTALS = InvoiceTotals(
    total_taxable=_ZERO,
    total_cgst=_ZERO,
    total_sgst=_ZERO,
    total_igst=_ZERO,
    raw_total=_ZERO,
    round_off=_ZERO,
    grand_total=_ZERO,
)


class InvoiceFormController:
    def __init__(self, app: Application) -> None:
        self._app = app
        self._working = Invoice()

    @property
    def working(self) -> Invoice:
        return self._working

    # --- setup ---

    def new_draft(self) -> Invoice:
        """Start a fresh working draft (not yet persisted)."""
        self._working = Invoice()
        return self._working

    def available_customers(self) -> Sequence[Customer]:
        """Active customers selectable for this invoice (Req 2.6)."""
        return self._app.customer_service_repo.list_active()

    def select_customer(self, customer_id: uuid.UUID) -> Invoice:
        """Attach a customer and default Place of Supply from its state (Req 11)."""
        customer = self._app.customer_service_repo.get(customer_id)
        if customer is None:
            raise ValueError("customer not found")
        self._working = self._working.model_copy(
            update={
                "customer_id": customer.id,
                "place_of_supply": PlaceOfSupply(
                    state_name=customer.bill_to.state_name,
                    state_code=customer.bill_to.state_code,
                ),
            }
        )
        return self._working

    def set_place_of_supply(self, state_name: str, state_code: str) -> Invoice:
        """Override the Place of Supply (Req 11)."""
        self._working = self._working.model_copy(
            update={"place_of_supply": PlaceOfSupply(state_name=state_name, state_code=state_code)}
        )
        return self._working

    def set_lines(self, lines: tuple[InvoiceLine, ...]) -> Invoice:
        self._working = self._working.model_copy(update={"lines": lines})
        return self._working

    def update_fields(self, **fields: object) -> Invoice:
        self._working = self._working.model_copy(update=fields)
        return self._working

    # --- live preview (Req 7) ---

    def tax_config(self) -> TaxRateConfig:
        return self._app.settings_service.get_tax_rate_config()

    def preview_totals(self) -> InvoiceTotals:
        """Compute display totals for the working lines via the engine (D-006).

        Returns zero totals when there are no lines or the tax context (company
        state / Place of Supply) is incomplete.
        """
        lines = self._working.lines
        if not lines:
            return _ZERO_TOTALS
        company = self._app.company_service_repo.get_active()
        pos_code = self._working.place_of_supply.state_code.strip()
        if company is None or not pos_code:
            return _ZERO_TOTALS

        config = self.tax_config()
        tax_type = determine_tax_type(company.address.state_code, pos_code)
        inputs = self._line_inputs(lines, tax_type, config)
        return calculate_invoice_totals(inputs)

    def _line_inputs(
        self,
        lines: tuple[InvoiceLine, ...],
        tax_type: TaxType,
        config: TaxRateConfig,
    ) -> list[TaxLineInput]:
        inputs: list[TaxLineInput] = []
        for line in lines:
            if line.tax_treatment is not TaxTreatment.TAXABLE:
                continue
            amounts = calculate_line(line.quantity, line.rate, line.discount_percent)
            tax = calculate_line_tax(amounts.taxable, tax_type, config)
            inputs.append(
                TaxLineInput(
                    hsn_sac=line.hsn_sac,
                    tax_treatment=line.tax_treatment,
                    tax_type=tax_type,
                    tax_rate=config.total_rate,
                    taxable=amounts.taxable,
                    cgst=tax.cgst,
                    sgst=tax.sgst,
                    igst=tax.igst,
                )
            )
        return inputs

    # --- persistence (Req 8, 9) ---

    def save_draft(self) -> ValidationResult:
        """Persist the working draft (permissive validation, Req 8).

        Creates the draft on first save, then updates it, keeping the working
        invoice's id stable.
        """
        service = self._app.invoice_service
        if service.get(self._working.id) is None:
            self._working = service.create_draft(self._working)
            return service.save_draft(self._working)
        return service.save_draft(self._working)

    def finalize(self, invoice_date: date) -> Invoice:
        """Finalize the working draft (strict, atomic, Req 9)."""
        self.save_draft()
        finalized = self._app.invoice_service.finalize(
            self._working.id, invoice_date=invoice_date
        )
        self._working = finalized
        return finalized

    def check_finalization(self, invoice_date: date) -> ValidationResult:
        """Return the strict finalization validation result without finalizing."""
        return self._app.invoice_service.check_finalization_readiness(
            self._working, invoice_date=invoice_date
        )

    # --- preview / export / print (Req 20) ---

    def render_preview(self) -> bytes:
        """Render the working (finalized) invoice to PDF bytes (Req 20.1)."""
        return self._app.pdf_service.render(self._working)

    def default_export_filename(self) -> str:
        """Deterministic export filename for the working invoice (Req 20.2)."""
        number = self._working.invoice_number or str(self._working.id)
        return self._app.pdf_service.export_filename(number)

    def export(self, output_path: str) -> str:
        """Export the working invoice PDF to ``output_path``; returns the path.

        Uses the same rendering as preview/print. An export failure does not
        modify the stored invoice (Req 20.5).
        """
        return str(self._app.pdf_service.export(self._working, output_path))

    def print(self, spool_dir: str) -> str:
        """Print the working invoice via the print service; returns spooled path."""
        return str(self._app.print_service.print_invoice(self._working, Path(spool_dir)))


__all__ = ["FinalizationError", "InvoiceFormController"]
