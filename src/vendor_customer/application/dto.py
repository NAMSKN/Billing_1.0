"""Application DTOs / commands for the Customer / Vendor (Party) master.

Frozen dataclasses that carry raw form input into the service. The service
trims, validates, and assembles the immutable :class:`Party` domain entity.
There is no GSTIN auto-fill: PAN and state code are never derived from a GSTIN.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from vendor_customer.domain.models import (
    OpeningBalance,
    PartyAddress,
    PartyType,
    RegistrationType,
)


@dataclass(frozen=True)
class PartyInput:
    """Shared party field payload used for create and update."""

    company_name: str
    company_type: PartyType = PartyType.CUSTOMER
    contact_person: str = ""
    contact_no: str = ""
    email: str = ""
    registration_type: RegistrationType = RegistrationType.UNREGISTERED
    gstin: str = ""
    pan: str = ""
    billing_address: PartyAddress = field(default_factory=PartyAddress)
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
    customer_balance: OpeningBalance = field(default_factory=OpeningBalance)
    vendor_balance: OpeningBalance = field(default_factory=OpeningBalance)


@dataclass(frozen=True)
class CreatePartyCommand:
    """Command to create a new party."""

    data: PartyInput


@dataclass(frozen=True)
class UpdatePartyCommand:
    """Command to update an existing party (identified by ``id``)."""

    id: uuid.UUID
    data: PartyInput
    is_active: bool = True
