"""Domain models for the unified Customer / Vendor (Party) master.

A single :class:`Party` record supports the customer role, the vendor role, or
both (``CUSTOMER_VENDOR``) so a business that is both is never duplicated
(product rules, section 7). Money (opening balances) uses ``Decimal`` in the
domain and is persisted as integer paise at the repository boundary; no float
is ever used for money (coding standards, DECISIONS D-004).

These are frozen pydantic models: immutable and hashable. Conversion to/from
storage happens only in the repository layer.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from enum import StrEnum

from pydantic import Field

from common.domain.base import DomainModel

INDIA = "India"


class PartyType(StrEnum):
    """Business-facing role of a party (product rules, section 7).

    A ``CUSTOMER_VENDOR`` participates in both customer and vendor contexts and
    may carry both opening balances. Duplicate records are never created for a
    dual-role business.
    """

    CUSTOMER = "CUSTOMER"
    VENDOR = "VENDOR"
    CUSTOMER_VENDOR = "CUSTOMER_VENDOR"

    @property
    def label(self) -> str:
        """User-facing display label."""
        return _PARTY_TYPE_LABELS[self]

    @property
    def is_customer(self) -> bool:
        """True if this party can act as a sales customer."""
        return self in (PartyType.CUSTOMER, PartyType.CUSTOMER_VENDOR)

    @property
    def is_vendor(self) -> bool:
        """True if this party can act as a purchase vendor."""
        return self in (PartyType.VENDOR, PartyType.CUSTOMER_VENDOR)


_PARTY_TYPE_LABELS: dict[PartyType, str] = {
    PartyType.CUSTOMER: "Customer",
    PartyType.VENDOR: "Vendor",
    PartyType.CUSTOMER_VENDOR: "Customer / Vendor",
}


class RegistrationType(StrEnum):
    """GST registration type of the party (product rules, section 8)."""

    UNREGISTERED = "UNREGISTERED"
    REGULAR = "REGULAR"
    REGULAR_SEZ = "REGULAR_SEZ"
    REGULAR_UIN = "REGULAR_UIN"

    @property
    def label(self) -> str:
        """User-facing display label."""
        return _REGISTRATION_TYPE_LABELS[self]

    @property
    def requires_gstin(self) -> bool:
        """True when a GSTIN is mandatory for this registration type.

        Unregistered parties never carry a GSTIN; every registered type does.
        """
        return self is not RegistrationType.UNREGISTERED


_REGISTRATION_TYPE_LABELS: dict[RegistrationType, str] = {
    RegistrationType.UNREGISTERED: "Unregistered",
    RegistrationType.REGULAR: "Regular",
    RegistrationType.REGULAR_SEZ: "Regular-SEZ",
    RegistrationType.REGULAR_UIN: "Regular-UIN",
}


class BalanceType(StrEnum):
    """Direction of an opening balance (product rules, section 13)."""

    DEBIT = "DEBIT"
    CREDIT = "CREDIT"

    @property
    def label(self) -> str:
        return "Debit" if self is BalanceType.DEBIT else "Credit"


class OpeningBalance(DomainModel):
    """An opening balance: a direction plus an exact monetary amount.

    Amount defaults to ``Decimal('0')`` (product rules: default ₹0). Stored as
    integer paise at the repository boundary. Never float.
    """

    balance_type: BalanceType = BalanceType.DEBIT
    amount: Decimal = Decimal("0")


class PartyAddress(DomainModel):
    """A billing or shipping address for a party (product rules, section 6).

    ``country`` defaults to India. For India, ``state`` and ``state_code`` are
    required by the application's validation rules and chosen from the state
    master (never free text). ``state_code`` is the GST state code.
    """

    address1: str = ""
    address2: str = ""
    landmark: str = ""
    country: str = INDIA
    state: str = ""
    state_code: str = ""
    city: str = ""
    pincode: str = ""

    @property
    def is_india(self) -> bool:
        """True when the address country is India (case-insensitive)."""
        return self.country.strip().lower() == INDIA.lower()

    @property
    def is_empty(self) -> bool:
        """True when no address field carries a value."""
        return not any(
            (
                self.address1.strip(),
                self.address2.strip(),
                self.landmark.strip(),
                self.state.strip(),
                self.state_code.strip(),
                self.city.strip(),
                self.pincode.strip(),
            )
        )


class BankDetails(DomainModel):
    """Optional banking details for a party (product rules, section 4)."""

    bank_name: str = ""
    ifsc_code: str = ""
    account_number: str = ""

    @property
    def is_empty(self) -> bool:
        return not any(
            (self.bank_name.strip(), self.ifsc_code.strip(), self.account_number.strip())
        )


class PartyGroup(DomainModel):
    """A selectable Customer / Vendor group (product rules, section 12).

    Groups are created, renamed, and archived through the UI. A group that is
    referenced by any party is never hard-deleted; it is archived instead.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    name: str = ""
    is_active: bool = True


class Party(DomainModel):
    """A unified trading party: Customer, Vendor, or both.

    Immutable domain entity keyed by an application-generated UUID4 that is
    distinct from any human-facing number (DECISIONS D-023/D-025). Optional
    fields default to empty/None so blank values persist successfully
    (product rules: Additional Details, E-Way Bill distance, etc. are optional).
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    company_type: PartyType = PartyType.CUSTOMER
    company_name: str = ""
    contact_person: str = ""
    contact_no: str = ""
    email: str = ""
    registration_type: RegistrationType = RegistrationType.UNREGISTERED
    gstin: str = ""
    pan: str = ""

    billing_address: PartyAddress = Field(default_factory=PartyAddress)
    shipping_address: PartyAddress | None = None

    distance_for_eway_bill_km: Decimal | None = None
    group_id: uuid.UUID | None = None

    bank_name: str = ""
    bank_ifsc_code: str = ""
    bank_account_number: str = ""

    fax_no: str = ""
    website: str = ""
    credit_limit: Decimal | None = None
    due_days: int | None = None
    note: str = ""
    visible_on_documents: bool = False

    custom_field_1: str = ""
    custom_field_2: str = ""
    custom_field_3: str = ""

    customer_balance: OpeningBalance = Field(default_factory=OpeningBalance)
    vendor_balance: OpeningBalance = Field(default_factory=OpeningBalance)

    is_active: bool = True
    created_at: str = ""
    updated_at: str = ""

    @property
    def bank_details(self) -> BankDetails:
        """Bank fields as a :class:`BankDetails` value object."""
        return BankDetails(
            bank_name=self.bank_name,
            ifsc_code=self.bank_ifsc_code,
            account_number=self.bank_account_number,
        )
