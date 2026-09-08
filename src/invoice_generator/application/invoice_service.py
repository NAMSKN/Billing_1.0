"""Invoice lifecycle service.

Orchestrates invoice use cases against repository ports. This task (Task 21)
implements the **draft** lifecycle only; finalization, cancellation,
duplication, and payment status are added in later tasks (22-27).

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

from invoice_generator.domain.enums import InvoiceStatus
from invoice_generator.domain.ids import IdGenerator, Uuid4Generator
from invoice_generator.domain.models import Invoice
from invoice_generator.domain.repositories import InvoiceRepository
from invoice_generator.domain.validation import ValidationResult, validate_draft


class InvoiceServiceError(Exception):
    """Raised for invalid invoice-service operations (e.g. wrong lifecycle state)."""


class InvoiceService:
    def __init__(
        self,
        connection: sqlite3.Connection,
        invoice_repository: InvoiceRepository,
        id_generator: IdGenerator | None = None,
    ) -> None:
        self._conn = connection
        self._invoices = invoice_repository
        self._ids: IdGenerator = id_generator if id_generator is not None else Uuid4Generator()

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
        with self._conn:  # own the transaction; repo participates
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
        with self._conn:
            self._invoices.save(invoice)
        return result

    def delete_draft(self, invoice_id: uuid.UUID) -> None:
        """Delete a draft and (via cascade) its line items.

        The repository only removes DRAFT rows; finalized/cancelled invoices are
        never hard-deleted through this path (Req 23.5).
        """
        with self._conn:
            self._invoices.delete_draft(invoice_id)
