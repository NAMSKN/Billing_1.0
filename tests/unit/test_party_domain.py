"""Unit tests for the party domain model and validation rules."""

from __future__ import annotations

from decimal import Decimal

from vendor_customer.domain.models import (
    INDIA,
    BalanceType,
    OpeningBalance,
    Party,
    PartyAddress,
    PartyType,
    RegistrationType,
)
from vendor_customer.domain.rules import (
    is_valid_gstin,
    is_valid_ifsc,
    is_valid_pan,
    normalize_company_name,
    validate_party,
)

VALID_GSTIN = "27ABCDE1234F1Z5"


def _india_party(**overrides: object) -> Party:
    base = dict(
        company_name="ACME Traders",
        billing_address=PartyAddress(state="Maharashtra", state_code="27", city="Pune"),
    )
    base.update(overrides)
    return Party(**base)  # type: ignore[arg-type]


def test_party_type_flags_and_labels() -> None:
    assert PartyType.CUSTOMER.is_customer and not PartyType.CUSTOMER.is_vendor
    assert PartyType.VENDOR.is_vendor and not PartyType.VENDOR.is_customer
    both = PartyType.CUSTOMER_VENDOR
    assert both.is_customer and both.is_vendor
    assert both.label == "Customer / Vendor"


def test_registration_type_gstin_requirement() -> None:
    assert not RegistrationType.UNREGISTERED.requires_gstin
    assert RegistrationType.REGULAR.requires_gstin
    assert RegistrationType.REGULAR_SEZ.label == "Regular-SEZ"


def test_country_defaults_to_india() -> None:
    assert PartyAddress().country == INDIA
    assert PartyAddress().is_india


def test_format_validators() -> None:
    assert is_valid_gstin(VALID_GSTIN)
    assert not is_valid_gstin("BAD")
    assert is_valid_pan("ABCDE1234F")
    assert not is_valid_pan("ABC")
    assert is_valid_ifsc("HDFC0000123")
    assert not is_valid_ifsc("BAD_IFSC")


def test_normalize_company_name() -> None:
    assert normalize_company_name("  ACME   Traders ") == "acme traders"


def test_company_name_required() -> None:
    errors = validate_party(_india_party(company_name=""))
    assert any("Company Name" in e for e in errors)


def test_india_requires_state_and_city() -> None:
    missing_state = _india_party(
        billing_address=PartyAddress(country=INDIA, city="Pune")
    )
    errors = validate_party(missing_state)
    assert any("State is required for India" in e for e in errors)

    missing_city = _india_party(
        billing_address=PartyAddress(country=INDIA, state="Maharashtra", state_code="27")
    )
    errors = validate_party(missing_city)
    assert any("City is required for India" in e for e in errors)


def test_non_india_does_not_require_state() -> None:
    party = _india_party(
        billing_address=PartyAddress(country="Nepal", city="Kathmandu")
    )
    assert validate_party(party) == []


def test_blank_eway_distance_accepted() -> None:
    party = _india_party(distance_for_eway_bill_km=None)
    assert validate_party(party) == []


def test_negative_eway_distance_rejected() -> None:
    party = _india_party(distance_for_eway_bill_km=Decimal("-5"))
    assert any("E-Way Bill distance" in e for e in validate_party(party))


def test_blank_additional_details_accepted() -> None:
    party = _india_party(
        fax_no="", website="", credit_limit=None, due_days=None, note="",
        custom_field_1="", custom_field_2="", custom_field_3="",
    )
    assert validate_party(party) == []


def test_registration_requires_gstin() -> None:
    party = _india_party(registration_type=RegistrationType.REGULAR, gstin="")
    assert any("GSTIN is required" in e for e in validate_party(party))


def test_unregistered_must_not_have_gstin() -> None:
    party = _india_party(registration_type=RegistrationType.UNREGISTERED, gstin=VALID_GSTIN)
    assert any("Unregistered" in e for e in validate_party(party))


def test_invalid_gstin_format_rejected() -> None:
    party = _india_party(registration_type=RegistrationType.REGULAR, gstin="NOTAGSTIN")
    assert any("Invalid GSTIN" in e for e in validate_party(party))


def test_opening_balance_defaults_zero() -> None:
    party = _india_party()
    assert party.customer_balance.amount == Decimal("0")
    assert party.customer_balance.balance_type is BalanceType.DEBIT


def test_opening_balance_stored() -> None:
    party = _india_party(
        customer_balance=OpeningBalance(balance_type=BalanceType.CREDIT, amount=Decimal("100.50")),
    )
    assert party.customer_balance.balance_type is BalanceType.CREDIT
    assert party.customer_balance.amount == Decimal("100.50")
