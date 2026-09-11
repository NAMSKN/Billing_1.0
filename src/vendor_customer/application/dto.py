"""Application DTOs and commands for Vendor & Customer Management."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

from vendor_customer.domain.models import BankDetails, Party, PartyRole
from common.domain.address import Address


@dataclass(frozen=True)
class CreatePartyCommand:
    display_name: str
    legal_name: str = ""
    role: PartyRole = PartyRole.CUSTOMER
    gstin: str = ""
    pan: str = ""
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    billing_address: Address = Address()
    shipping_address: Optional[Address] = None
    bank_details: Optional[BankDetails] = None
    credit_days: int = 0


@dataclass(frozen=True)
class UpdatePartyCommand:
    id: uuid.UUID
    display_name: str
    legal_name: str = ""
    role: PartyRole = PartyRole.CUSTOMER
    gstin: str = ""
    pan: str = ""
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    billing_address: Address = Address()
    shipping_address: Optional[Address] = None
    bank_details: Optional[BankDetails] = None
    credit_days: int = 0
    is_active: bool = True
