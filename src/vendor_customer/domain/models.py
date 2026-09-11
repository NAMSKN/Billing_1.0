"""Domain models for Vendor & Customer Management."""

from __future__ import annotations

import uuid
from enum import Enum
from typing import Optional

from pydantic import Field

from common.domain.address import Address
from common.domain.base import DomainModel


class PartyRole(str, Enum):
    """Role of the trading party."""

    CUSTOMER = "CUSTOMER"
    VENDOR = "VENDOR"
    BOTH = "BOTH"


class BankDetails(DomainModel):
    """Banking credentials for supplier/vendor disbursements."""

    bank_name: str = ""
    account_number: str = ""
    ifsc_code: str = ""
    branch: str = ""


class Party(DomainModel):
    """A trading partner: Customer, Vendor, or Both.

    Immutable domain entity. Identity is a UUID4.
    """

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    display_name: str
    legal_name: str = ""
    role: PartyRole = PartyRole.CUSTOMER
    gstin: str = ""
    pan: str = ""
    contact_person: str = ""
    phone: str = ""
    email: str = ""
    billing_address: Address = Field(default_factory=Address)
    shipping_address: Optional[Address] = None
    bank_details: Optional[BankDetails] = None
    credit_days: int = 0
    is_active: bool = True
