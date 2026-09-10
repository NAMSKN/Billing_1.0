"""Invoice lifecycle service.

Orchestrates invoice use cases against repository ports: draft lifecycle
(Task 21), finalization validation and atomic finalization (Tasks 22-23),
finalized snapshots (Task 24), and cancellation (Task 25). Duplication and
payment status follow in Tasks 26-27.

Transaction ownership (DECISIONS D-026): the service owns the transaction
boundary and commits/rolls back; the repository participates and never commits
on its own. Draft saves are small independent transactions (design section 22).

Draft rules (Req 8): a draft may be incomplete. Saving uses the permissive
:func:`validate_draft` path and returns non-blocking warnings rather than
blocking. A draft has a UUID id but no invoice number (``invoice_number`` stays
``None``); a final number is only allocated at finalization (DECISIONS D-025,
D-027). Ids are generated via an injected :class:`IdGenerator` for deterministic
tests (DECISIONS D-023).

References: requirements Req 8; DECISIONS D-021, D-023, D-025, D-026;
design sections 10, 22.
"""

from __future__ import annotations

import sqlite3
import uuid
from datetime import date, datetime

from invoice_generator.application.clock import Clock, SystemClock
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.application.unit_of_work import UnitOfWork
from invoice_generator.domain.amount_words import amount_in_words
from invoice_generator.domain.calculation import (
    TaxLineInput,
    build_tax_summary,
    calculate_invoice_totals,
    calculate_line,
    calculate_line_tax,
    determine_tax_type,
    ensure_supported_treatment,
)
from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus, TaxType
from invoice_generator.domain.ids import IdGenerator, Uuid4Generator
from invoice_generator.domain.models import (
    Invoice,
    InvoiceLine,
    InvoiceSnapshot,
    TaxRateConfig,
)
from invoice_generator.domain.numbering import NumberingConfig
from invoice_generator.domain.repositories import (
    CompanyRepository,
    CustomerRepository,
    InvoiceRepository,
)
from invoice_generator.domain.validation import (
    ValidationResult,
    validate_draft,
    validate_for_finalization,
)


class FinalizationError(Exception):
    """Raised when finalization cannot proceed (validation or state errors)."""

    def __init__(self, message: str, result: ValidationResult | None = None) -> None:
        super().__init__(message)
        self.result = result


class InvoiceServiceError(Exception):
    """Raised for invalid invoice-service operations (e.g. wrong lifecycle state)."""


class InvoiceService:
    #: Template/layout version pinned on invoices finalized by this build
    #: (DECISIONS D-020). Bumped when the PDF layout changes materially.
    DEFAULT_TEMPLATE_VERSION = 1

    def __init__(
        self,
        connection: sqlite3.Connection,
        invoice_repository: InvoiceRepository,
        company_repository: CompanyRepository | None = None,
        customer_repository: CustomerRepository | None = None,
        numbering_service: NumberingService | None = None,
        settings_service: SettingsService | None = None,
        id_generator: IdGenerator | None = None,
        clock: Clock | None = None,
    ) -> None:
        self._conn = connection
        self._invoices = invoice_repository
        self._companies = company_repository
        self._customers = customer_repository
        self._numbering = numbering_service
        self._settings = settings_service
        self._ids: IdGenerator = id_generator if id_generator is not None else Uuid4Generator()
        self._clock: Clock = clock if clock is not None else SystemClock()

    def get(self, invoice_id: uuid.UUID) -> Invoice | None:
        return self._invoices.get(invoice_id)

    def create_draft(self, invoice: Invoice | None = None) -> Invoice:
        """Create and persist a new draft, returning it.

        A fresh id is assigned from the injected generator; status is forced to
        DRAFT and the invoice number is cleared. If ``invoice`` is provided its
        editable content is used as the starting point.
        """
        base = invoice if invoice is not None else Invoice()
        draft = base.model_copy(
            update={
                "id": self._ids(),
                "status": InvoiceStatus.DRAFT,
                "invoice_number": None,
            }
        )
        with UnitOfWork(self._conn):  # own the transaction; repo participates
            self._invoices.save(draft)
        return draft

    def save_draft(self, invoice: Invoice) -> ValidationResult:
        """Persist edits to a draft. Returns permissive validation warnings.

        Raises :class:`InvoiceServiceError` if the invoice is not a draft; a
        finalized/cancelled invoice must not be edited through this path
        (finalized immutability, Req 9/10). No invoice number is allocated.
        """
        if invoice.status is not InvoiceStatus.DRAFT:
            raise InvoiceServiceError("save_draft is only valid for DRAFT invoices")
        if invoice.invoice_number is not None:
            raise InvoiceServiceError("a draft must not carry an invoice number")

        result = validate_draft(invoice)
        with UnitOfWork(self._conn):
            self._invoices.save(invoice)
        return result

    def check_finalization_readiness(
        self,
        invoice: Invoice,
        *,
        invoice_date: date,
        due_date: date | None = None,
        today: date | None = None,
    ) -> ValidationResult:
        """Run the strict finalization validation gate (Req 9.1).

        Loads the invoice's company (active) and customer, then applies
        :func:`validate_for_finalization`, which enforces the required
        company/customer/date/place-of-supply/line rules in order and returns
        **blocking** issues. This is distinct from the permissive
        :meth:`save_draft` path (finding 3.1) and performs no number allocation
        or persistence — that is atomic finalization (Task 23).

        Raises :class:`InvoiceServiceError` if the required master repositories
        were not provided, or if the invoice/customer cannot be resolved.
        """
        if self._companies is None or self._customers is None:
            raise InvoiceServiceError(
                "company and customer repositories are required for finalization"
            )
        if invoice.status is not InvoiceStatus.DRAFT:
            raise InvoiceServiceError("only a DRAFT invoice can be finalized")

        company = self._companies.get_active()
        if company is None:
            raise InvoiceServiceError("no active company is configured")
        if invoice.customer_id is None:
            raise InvoiceServiceError("invoice has no customer selected")
        customer = self._customers.get(invoice.customer_id)
        if customer is None:
            raise InvoiceServiceError("selected customer does not exist")

        return validate_for_finalization(
            invoice,
            company=company,
            customer=customer,
            invoice_date=invoice_date,
            due_date=due_date,
            today=today,
        )

    def finalize(
        self,
        invoice_id: uuid.UUID,
        *,
        invoice_date: date,
        due_date: date | None = None,
        today: date | None = None,
    ) -> Invoice:
        """Finalize a draft atomically within one owned transaction (design section 22).

        Flow: load draft -> strict validate -> resolve tax type -> calculate
        lines/tax/totals -> allocate number -> build snapshot -> pin template ->
        persist -> COMMIT. Any failure rolls back completely (no partial invoice;
        an allocated-but-rolled-back number is not issued and may be reused,
        DECISIONS D-027). The number is issued only when the COMMIT succeeds.
        """
        if self._companies is None or self._customers is None:
            raise FinalizationError("company and customer repositories are required")
        if self._numbering is None or self._settings is None:
            raise FinalizationError("numbering and settings services are required")

        draft = self._invoices.get(invoice_id)
        if draft is None:
            raise FinalizationError("invoice not found")
        if draft.status is not InvoiceStatus.DRAFT:
            raise FinalizationError("only a DRAFT invoice can be finalized")

        company = self._companies.get_active()
        if company is None:
            raise FinalizationError("no active company is configured")
        if draft.customer_id is None:
            raise FinalizationError("invoice has no customer selected")
        customer = self._customers.get(draft.customer_id)
        if customer is None:
            raise FinalizationError("selected customer does not exist")

        result = validate_for_finalization(
            draft,
            company=company,
            customer=customer,
            invoice_date=invoice_date,
            due_date=due_date,
            today=today,
        )
        if not result.is_ok:
            raise FinalizationError("invoice failed finalization validation", result)

        tax_config = self._settings.get_tax_rate_config()
        tax_type = determine_tax_type(
            company.address.state_code, draft.place_of_supply.state_code
        )

        # Compute lines and their tax within the transaction's inputs.
        computed_lines, tax_inputs = self._compute_lines(draft.lines, tax_type, tax_config)
        totals = calculate_invoice_totals(tax_inputs)
        tax_summary = build_tax_summary(tax_inputs)

        numbering_config = self._numbering_config()
        # Atomic finalization transaction (BEGIN IMMEDIATE ... COMMIT).
        with UnitOfWork(self._conn):
            allocation = self._numbering.allocate(company.id, invoice_date, numbering_config)
            snapshot = InvoiceSnapshot(
                company=company,
                customer=customer,
                bill_to=customer.bill_to,
                ship_to=customer.ship_to,
                place_of_supply=draft.place_of_supply,
                references=draft.references,
                lines=computed_lines,
                totals=totals,
                tax_summary=tax_summary,
                tax_rate_config=tax_config,
                payment_terms=draft.payment_terms,
                due_date=draft.due_date,
                notes=draft.notes,
                terms=draft.terms,
                declaration=draft.declaration,
                grand_total_words=amount_in_words(totals.grand_total),
                tax_amount_words=amount_in_words(
                    totals.total_cgst + totals.total_sgst + totals.total_igst
                ),
                logo_asset_id=company.logo_asset_id,
                signature_asset_id=company.signature_asset_id,
            )
            finalized = draft.model_copy(
                update={
                    "status": InvoiceStatus.FINALIZED,
                    "invoice_number": allocation.invoice_number,
                    "invoice_date": invoice_date.isoformat(),
                    "company_id": company.id,
                    "lines": computed_lines,
                    "totals": totals,
                    "template_version": self.DEFAULT_TEMPLATE_VERSION,
                    "snapshot": snapshot,
                }
            )
            self._invoices.save(finalized)
        return finalized

    def _numbering_config(self) -> NumberingConfig:
        assert self._settings is not None
        return self._settings.get_numbering_config()

    def _compute_lines(
        self,
        lines: tuple[InvoiceLine, ...],
        tax_type: TaxType,
        tax_config: TaxRateConfig,
    ) -> tuple[tuple[InvoiceLine, ...], list[TaxLineInput]]:
        computed: list[InvoiceLine] = []
        inputs: list[TaxLineInput] = []
        for line in lines:
            ensure_supported_treatment(line.tax_treatment)
            amounts = calculate_line(line.quantity, line.rate, line.discount_percent)
            tax = calculate_line_tax(amounts.taxable, tax_type, tax_config)
            computed.append(
                line.model_copy(
                    update={
                        "tax_rate": tax_config.total_rate,
                        "taxable_amount": amounts.taxable,
                        "cgst_amount": tax.cgst,
                        "sgst_amount": tax.sgst,
                        "igst_amount": tax.igst,
                    }
                )
            )
            inputs.append(
                TaxLineInput(
                    hsn_sac=line.hsn_sac,
                    tax_treatment=line.tax_treatment,
                    tax_type=tax_type,
                    tax_rate=tax_config.total_rate,
                    taxable=amounts.taxable,
                    cgst=tax.cgst,
                    sgst=tax.sgst,
                    igst=tax.igst,
                )
            )
        return tuple(computed), inputs

    def cancel(
        self,
        invoice_id: uuid.UUID,
        reason: str,
        *,
        when: datetime | None = None,
        replacement_invoice_id: uuid.UUID | None = None,
    ) -> Invoice:
        """Cancel a finalized invoice, preserving the record (design section 13).

        Sets status CANCELLED with a cancellation timestamp and reason; keeps
        the same UUID, invoice number, and snapshot; never hard-deletes; and may
        record a replacement invoice (DECISIONS D-016, D-025). ``when`` should be
        supplied by the caller for determinism; it defaults to the current UTC
        time. Only a FINALIZED invoice may be cancelled.
        """
        invoice = self._invoices.get(invoice_id)
        if invoice is None:
            raise InvoiceServiceError("invoice not found")
        if invoice.status is not InvoiceStatus.FINALIZED:
            raise InvoiceServiceError("only a FINALIZED invoice can be cancelled")

        timestamp = (when if when is not None else self._clock.now()).isoformat()
        cancelled = invoice.model_copy(
            update={
                "status": InvoiceStatus.CANCELLED,
                "cancelled_at": timestamp,
                "cancel_reason": reason,
                "replacement_invoice_id": replacement_invoice_id,
            }
        )
        with UnitOfWork(self._conn):
            self._invoices.save(cancelled)
        return cancelled

    def duplicate(self, invoice_id: uuid.UUID) -> Invoice:
        """Duplicate an invoice into a NEW draft (design section 14).

        Copies only editable business content (customer selection, place of
        supply, references, line items, notes/terms/declaration, payment terms).
        Excludes the original id, finalized state, invoice number, payment
        status, totals, snapshot, and cancellation data. The duplicate receives
        a new UUID and no number; a number is assigned only when it is finalized
        (DECISIONS D-017, D-025). The original is left unchanged.
        """
        source = self._invoices.get(invoice_id)
        if source is None:
            raise InvoiceServiceError("invoice not found")

        copied_lines = tuple(
            line.model_copy(
                update={
                    "id": self._ids(),
                    "taxable_amount": None,
                    "cgst_amount": None,
                    "sgst_amount": None,
                    "igst_amount": None,
                }
            )
            for line in source.lines
        )
        duplicate = Invoice(
            id=self._ids(),
            status=InvoiceStatus.DRAFT,
            invoice_number=None,
            customer_id=source.customer_id,
            place_of_supply=source.place_of_supply,
            references=source.references,
            lines=copied_lines,
            payment_terms=source.payment_terms,
            due_date=source.due_date,
            notes=source.notes,
            terms=source.terms,
            declaration=source.declaration,
        )
        with UnitOfWork(self._conn):
            self._invoices.save(duplicate)
        return duplicate

    def set_payment_status(
        self,
        invoice_id: uuid.UUID,
        status: PaymentStatus,
    ) -> Invoice:
        """Set the payment status, independent of the invoice lifecycle.

        Payment status (UNPAID/PARTIAL/PAID) is separate from
        DRAFT/FINALIZED/CANCELLED (DECISIONS D-015): e.g. FINALIZED + UNPAID is
        valid. Changing it updates only ``payment_status`` and never alters any
        financial value, the totals, the snapshot, or the invoice number. V1
        keeps no receipt ledger and tracks no paid amount (OPEN_QUESTIONS Q-011).
        """
        invoice = self._invoices.get(invoice_id)
        if invoice is None:
            raise InvoiceServiceError("invoice not found")
        updated = invoice.model_copy(update={"payment_status": status})
        with UnitOfWork(self._conn):
            self._invoices.save(updated)
        return updated

    def delete_draft(self, invoice_id: uuid.UUID) -> None:
        """Delete a draft and (via cascade) its line items.

        The repository only removes DRAFT rows; finalized/cancelled invoices are
        never hard-deleted through this path (Req 23.5).
        """
        with UnitOfWork(self._conn):
            self._invoices.delete_draft(invoice_id)
