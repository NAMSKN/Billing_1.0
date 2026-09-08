"""Domain enumerations.

Defines the invoice lifecycle status, payment status, tax type, and tax
treatment. These are distinct concerns and MUST NOT be mixed:

- Invoice lifecycle (:class:`InvoiceStatus`) tracks where the invoice is in its
  life: draft, finalized, or cancelled.
- Payment status (:class:`PaymentStatus`) is an independent local marker of
  whether the invoice has been paid (DECISIONS D-015). It never changes
  financial calculations or the invoice number.

Each enum is a :class:`enum.StrEnum` so its members serialize to stable,
human-readable values for SQLite TEXT columns, JSON snapshots, and logs. The
stored value is
the member's string value (e.g. ``"DRAFT"``), which must remain stable across
versions once persisted.

References: requirements Req 8 (draft lifecycle), Req 13 (payment status),
Req 6 (GST); DECISIONS D-007, D-008, D-015; design section 2.
"""

from __future__ import annotations

from enum import StrEnum


class InvoiceStatus(StrEnum):
    """Lifecycle state of an invoice (independent of payment status).

    Transitions (enforced by the invoice service, not by this enum):
    ``DRAFT`` -> ``FINALIZED`` -> ``CANCELLED``. A draft may be deleted; a
    finalized or cancelled invoice is never hard-deleted through normal
    workflows.
    """

    DRAFT = "DRAFT"
    FINALIZED = "FINALIZED"
    CANCELLED = "CANCELLED"


class PaymentStatus(StrEnum):
    """Payment marker, independent of :class:`InvoiceStatus` (DECISIONS D-015).

    For example, an invoice may be ``FINALIZED`` and ``UNPAID`` at the same
    time. V1 treats this as a display/local marker only; there is no receipt
    ledger and ``PARTIAL`` carries no tracked amount (OPEN_QUESTIONS Q-011).
    """

    UNPAID = "UNPAID"
    PARTIAL = "PARTIAL"
    PAID = "PAID"


class TaxType(StrEnum):
    """Whether a supply is taxed intra-state (CGST+SGST) or inter-state (IGST).

    Determined by the calculation engine from the company state versus the
    explicit Place of Supply (Req 6, Req 11); never inferred in the UI.
    """

    INTRA_STATE = "INTRA_STATE"
    INTER_STATE = "INTER_STATE"


class TaxTreatment(StrEnum):
    """GST treatment of a supply.

    V1 supports only :attr:`TAXABLE` (DECISIONS D-007). Special treatments
    such as reverse charge, exempt, nil-rated, zero-rated, export, and SEZ are
    explicitly out of scope for V1 and MUST NOT be silently modeled as a
    generic 0% rate (DECISIONS D-008). This enum is the intended extension
    point: future treatments would be added here as new members with their own
    calculation handling, rather than by abusing ``TAXABLE`` with a zero rate.
    """

    TAXABLE = "TAXABLE"
