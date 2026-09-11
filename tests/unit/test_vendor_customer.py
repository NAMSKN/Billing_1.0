"""Unit tests for the new vendor_customer feature."""

import sqlite3
import uuid

import pytest

from common.domain.address import Address
from vendor_customer.application.dto import CreatePartyCommand, UpdatePartyCommand
from vendor_customer.application.party_service import PartyService
from vendor_customer.domain.models import BankDetails, PartyRole
from vendor_customer.domain.rules import (
    extract_pan,
    extract_state_code,
    is_valid_gstin,
    is_valid_ifsc,
)
from vendor_customer.infrastructure.db.sqlite_party_repository import (
    SqlitePartyRepository,
)


def test_gstin_and_pan_rules() -> None:
    valid_gstin = "27AABCU9603R1ZM"
    assert is_valid_gstin(valid_gstin) is True
    assert extract_state_code(valid_gstin) == "27"
    assert extract_pan(valid_gstin) == "AABCU9603R"

    invalid_gstin = "INVALID_GST"
    assert is_valid_gstin(invalid_gstin) is False

    assert is_valid_ifsc("HDFC0000123") is True
    assert is_valid_ifsc("BAD_IFSC") is False


def test_party_service_lifecycle() -> None:
    conn = sqlite3.connect(":memory:")
    repo = SqlitePartyRepository(conn)
    service = PartyService(repo)

    # 1. Create a customer
    customer = service.create_party(
        CreatePartyCommand(
            display_name="DI-TECH MOULDS",
            legal_name="DI-TECH MOULDS PVT LTD",
            role=PartyRole.CUSTOMER,
            gstin="27AABCU9603R1ZM",
            billing_address=Address(line="Plot 12, Bhosari MIDC", state="Maharashtra"),
        )
    )
    assert customer.id is not None
    assert customer.pan == "AABCU9603R"
    assert customer.billing_address.state_code == "27"

    # 2. Create a vendor with bank details
    vendor = service.create_party(
        CreatePartyCommand(
            display_name="BMSS STEEL",
            role=PartyRole.VENDOR,
            gstin="27AACFB2801D1Z1",
            bank_details=BankDetails(
                bank_name="State Bank of India",
                account_number="1234567890",
                ifsc_code="SBIN0001234",
            ),
        )
    )
    assert vendor.role == PartyRole.VENDOR
    assert vendor.bank_details is not None
    assert vendor.bank_details.ifsc_code == "SBIN0001234"

    # 3. List parties
    all_parties = service.list_parties()
    assert len(all_parties) == 2

    cust_only = service.list_parties(role=PartyRole.CUSTOMER)
    assert len(cust_only) == 1
    assert cust_only[0].display_name == "DI-TECH MOULDS"

    # 4. Duplicate GSTIN prevention
    with pytest.raises(ValueError, match="already exists"):
        service.create_party(
            CreatePartyCommand(
                display_name="Duplicate Entity",
                gstin="27AABCU9603R1ZM",
            )
        )

    # 5. Archive party (soft delete)
    assert service.archive_party(customer.id) is True
    active_parties = service.list_parties(include_inactive=False)
    assert len(active_parties) == 1
    assert active_parties[0].display_name == "BMSS STEEL"

    conn.close()
