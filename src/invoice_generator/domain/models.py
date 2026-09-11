"""Domain models.

Immutable (frozen) domain entities and value objects. Money, rate, quantity,
and percentages are represented as :class:`~decimal.Decimal` in the domain
(never ``float``); repositories convert to/from exact scaled integers at the
persistence boundary (see :mod:`invoice_generator.domain.money`, DECISIONS
D-004/D-005).

Identity: every persistent entity has a UUID ``id`` (DECISIONS D-023). Ids
default to a fresh UUID4 for convenience, but services generate ids through an
injected :class:`~invoice_generator.domain.ids.IdGenerator` and pass them
explicitly. The invoice UUID (``Invoice.id``) is distinct from the human-
readable ``Invoice.invoice_number``, which is ``None`` until finalization
(DECISIONS D-025).

Immutability: models are frozen. "Editing" a draft produces a new instance via
``model_copy(update=...)``; the ``id`` is preserved (never regenerated) unless
explicitly changed. Finalized values are therefore stable historical records.

This task (Task 5) defines model *structure*. Field-format validation (GSTIN,
email, IFSC) and draft-vs-finalize business validation are added in Task 6.

References: requirements Req 1, 2, 3, 4, 12, 30; DECISIONS D-023, D-025, D-030;
design sections 2, 3, 11, 13.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from invoice_generator.domain.enums import (
    InvoiceStatus,
    PaymentStatus,
    TaxTreatment,
    TaxType,
)


class DomainModel(BaseModel):
    """Base for frozen domain models.

    ``frozen=True`` makes instances immutable and hashable. ``extra="forbid"``
    rejects unknown fields so typos surface early.
    """

    model_config = ConfigDict(frozen=True, extra="forbid")


class Address(DomainModel):
    """A postal address plus its GST state identity.

    Used for both billing and shipping/consignee addresses. Bill-to and
    ship-to are always modeled as distinct :class:`Address` values even when
    identical (design section 2).
    """

    line: str = ""
    state_name: str = ""
    state_code: str = ""
    godown: str = ""


class TaxRateConfig(DomainModel):
    """Explicit GST component rates (percent values), per DECISIONS D-030.

    The engine consumes these configured components; it never derives CGST/SGST
    by halving ``total_rate``. Normal V1 config: 18 total / 9 CGST / 9 SGST /
    18 IGST. Rates are percentages (e.g. ``Decimal("9")`` means 9%).
    """

    total_rate: Decimal
    cgst_rate: Decimal
    sgst_rate: Decimal
    igst_rate: Decimal


class Asset(DomainModel):
    """A versioned invoice asset: logo, signature, or stamp (DECISIONS D-019).

    Assets are content-addressed/versioned rather than mutable paths, so a
    finalized invoice can pin the exact version it used. ``sha256`` identifies
    the content and ``stored_path`` locates the bytes in the local asset store.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    kind: str = ""
    version: int = 1
    sha256: str = ""
    stored_path: str = ""
    created_at: str = ""


class SequenceState(DomainModel):
    """Persisted numbering-sequence state for one scope (design section 9).

    Scoped by company + financial year + prefix. ``next_sequence`` is the value
    the next allocation will take; ``high_water_mark`` is the highest sequence
    ever issued in this scope, used for restore reconciliation (DECISIONS
    D-029).
    """

    company_id: uuid.UUID
    financial_year: str
    prefix: str
    next_sequence: int
    high_water_mark: int = 0


class Company(DomainModel):
    """Supplier/company master (Req 1). Single active company in V1."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str = ""
    address: Address = Field(default_factory=Address)
    gstin: str = ""
    email: str = ""
    phone: str = ""
    bank_name: str = ""
    account_number: str = ""
    branch: str = ""
    ifsc: str = ""
    upi_id: str = ""
    authorized_signatory: str = ""
    logo_asset_id: uuid.UUID | None = None
    signature_asset_id: uuid.UUID | None = None
    active: bool = True


class Customer(DomainModel):
    """Customer master (Req 2).

    Billing and shipping addresses are distinct; ``ship_to`` may equal
    ``bill_to`` but is stored separately.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str = ""
    gstin: str = ""
    phone: str = ""
    email: str = ""
    bill_to: Address = Field(default_factory=Address)
    ship_to: Address = Field(default_factory=Address)
    is_active: bool = True


class ServiceTemplate(DomainModel):
    """A reusable service description for faster line entry (Req 29, P2).

    Templates capture only descriptive fields (name, description, HSN/SAC,
    unit) — never price, quantity, or stock — so inserting one pre-fills an
    invoice line that stays freely editable, without introducing any inventory
    or product-management concept (Req 29.3).
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str = ""
    description: str = ""
    hsn_sac: str = ""
    unit: str = ""


class InvoiceLine(DomainModel):
    """A single mould/machining line item (Req 4, design section 13).

    Structured technical fields plus a free-text description. Monetary and
    numeric values are ``Decimal`` in the domain. Calculated amounts are set by
    the calculation engine (later task) and default to ``None`` until computed.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    sequence: int = 0
    job_or_mould_reference: str = ""
    component_or_part: str = ""
    operation: str = ""
    description: str = ""
    specification: str = ""
    hsn_sac: str = ""
    quantity: Decimal = Decimal(0)
    unit: str = ""
    rate: Decimal = Decimal(0)
    discount_percent: Decimal = Decimal(0)
    tax_treatment: TaxTreatment = TaxTreatment.TAXABLE
    tax_rate: Decimal = Decimal(0)
    # Calculated amounts (populated by the calculation engine).
    taxable_amount: Decimal | None = None
    cgst_amount: Decimal | None = None
    sgst_amount: Decimal | None = None
    igst_amount: Decimal | None = None


class TaxSummaryRow(DomainModel):
    """One tax-summary group (design section 6).

    Grouped by the composite key {HSN/SAC + tax treatment + applicable rate(s)},
    never by HSN/SAC alone. Reconciles exactly to line-level tax and totals.
    """

    hsn_sac: str
    tax_treatment: TaxTreatment
    tax_type: TaxType
    tax_rate: Decimal
    taxable_value: Decimal
    cgst_amount: Decimal
    sgst_amount: Decimal
    igst_amount: Decimal
    total_tax: Decimal


class InvoiceTotals(DomainModel):
    """Aggregated invoice totals (design section 5)."""

    total_taxable: Decimal
    total_cgst: Decimal
    total_sgst: Decimal
    total_igst: Decimal
    raw_total: Decimal
    round_off: Decimal
    grand_total: Decimal


class PlaceOfSupply(DomainModel):
    """Explicit place of supply (Req 11): the authoritative tax-type input."""

    state_name: str = ""
    state_code: str = ""


class InvoiceReferences(DomainModel):
    """Optional invoice reference/logistics fields (Req 3). All optional."""

    delivery_note: str = ""
    delivery_note_date: str = ""
    reference_number: str = ""
    reference_date: str = ""
    buyer_order_number: str = ""
    buyer_order_date: str = ""
    dispatch_doc_number: str = ""
    dispatch_date: str = ""
    lr_rr_number: str = ""
    vehicle_number: str = ""
    dispatched_through: str = ""
    destination: str = ""
    terms_of_delivery: str = ""
    other_references: str = ""


class InvoiceSnapshot(DomainModel):
    """Immutable invoice-facing snapshot for a finalized invoice (Req 12).

    Captures everything needed to reproduce the document independent of live
    master data (DECISIONS D-010). This task defines the structure; population
    at finalization and JSON persistence are wired in later tasks.
    """

    company: Company
    customer: Customer
    bill_to: Address
    ship_to: Address
    place_of_supply: PlaceOfSupply
    references: InvoiceReferences
    lines: tuple[InvoiceLine, ...]
    totals: InvoiceTotals
    tax_summary: tuple[TaxSummaryRow, ...]
    tax_rate_config: TaxRateConfig
    payment_terms: str = ""
    due_date: str = ""
    notes: str = ""
    terms: str = ""
    declaration: str = ""
    grand_total_words: str = ""
    tax_amount_words: str = ""
    logo_asset_id: uuid.UUID | None = None
    signature_asset_id: uuid.UUID | None = None


class Invoice(DomainModel):
    """An invoice (Req 3, 12; design sections 2, 12).

    ``id`` is the internal UUID identity; ``invoice_number`` is the human-
    readable business number, ``None`` until finalization (DECISIONS D-025).
    Lifecycle ``status`` and ``payment_status`` are independent fields
    (DECISIONS D-015). A finalized invoice carries an immutable ``snapshot``
    plus its pinned ``template_version``.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    invoice_number: str | None = None
    status: InvoiceStatus = InvoiceStatus.DRAFT
    payment_status: PaymentStatus = PaymentStatus.UNPAID
    invoice_date: str = ""
    company_id: uuid.UUID | None = None
    customer_id: uuid.UUID | None = None
    place_of_supply: PlaceOfSupply = Field(default_factory=PlaceOfSupply)
    references: InvoiceReferences = Field(default_factory=InvoiceReferences)
    lines: tuple[InvoiceLine, ...] = ()
    totals: InvoiceTotals | None = None
    payment_terms: str = ""
    due_date: str = ""
    notes: str = ""
    terms: str = ""
    declaration: str = ""
    template_version: int | None = None
    snapshot: InvoiceSnapshot | None = None
    cancelled_at: str = ""
    cancel_reason: str = ""
    replacement_invoice_id: uuid.UUID | None = None
