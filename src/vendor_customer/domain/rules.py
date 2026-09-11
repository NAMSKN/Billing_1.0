"""Validation and domain rules for the Customer / Vendor (Party) master.

All GST validation is offline and format-only: there is NO GSTIN auto-fill and
NO external lookup (product rules, sections 2/8). Values are never mutated here;
these are pure predicates and a :func:`validate_party` function that returns a
list of human-readable error messages.
"""

from __future__ import annotations

import re
from decimal import Decimal

from vendor_customer.domain.models import Party, RegistrationType

GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")
PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def is_valid_gstin(gstin: str) -> bool:
    """True if ``gstin`` matches the 15-character Indian GSTIN format.

    Format-only; no checksum, no network verification (product rules).
    """
    if not gstin:
        return False
    return bool(GSTIN_PATTERN.match(gstin.strip().upper()))


def is_valid_pan(pan: str) -> bool:
    """True if ``pan`` matches the 10-character Indian PAN format."""
    if not pan:
        return False
    return bool(PAN_PATTERN.match(pan.strip().upper()))


def is_valid_ifsc(ifsc: str) -> bool:
    """True if ``ifsc`` matches the 11-character IFSC format."""
    if not ifsc:
        return False
    return bool(IFSC_PATTERN.match(ifsc.strip().upper()))


def is_valid_email(email: str) -> bool:
    """True if ``email`` looks like a valid address (permissive, offline)."""
    if not email:
        return False
    return bool(_EMAIL_PATTERN.match(email.strip()))


def normalize_company_name(name: str) -> str:
    """Return a normalized key for duplicate matching (case/space-insensitive)."""
    return re.sub(r"\s+", " ", name.strip()).lower()


def validate_party(party: Party) -> list[str]:
    """Validate a party and return a list of blocking error messages.

    Rules (product rules sections 2, 4, 8, 9, 10, 13, 17):
      - Company Name is required.
      - For an India billing address, State and City are required.
      - GSTIN, when provided, must be format-valid; a registration type that
        requires a GSTIN must have one.
      - PAN / IFSC / email, when provided, must be format-valid.
      - E-Way Bill distance, credit limit, due days and opening balances, when
        provided, must be non-negative. Blank values are always accepted.
    """
    errors: list[str] = []

    if not party.company_name.strip():
        errors.append("Company Name is required.")

    billing = party.billing_address
    if billing.is_india:
        if not billing.state.strip():
            errors.append("State is required for India.")
        if not billing.city.strip():
            errors.append("City is required for India.")
    if party.shipping_address is not None and party.shipping_address.is_india:
        ship = party.shipping_address
        if not ship.is_empty:
            if not ship.state.strip():
                errors.append("Shipping State is required for India.")
            if not ship.city.strip():
                errors.append("Shipping City is required for India.")

    gstin = party.gstin.strip().upper()
    if gstin and not is_valid_gstin(gstin):
        errors.append(f"Invalid GSTIN format: {party.gstin!r}.")
    if party.registration_type.requires_gstin and not gstin:
        label = party.registration_type.label
        errors.append(f"GSTIN is required for registration type '{label}'.")
    if party.registration_type is RegistrationType.UNREGISTERED and gstin:
        errors.append("An Unregistered party must not have a GSTIN.")

    if party.pan.strip() and not is_valid_pan(party.pan):
        errors.append(f"Invalid PAN format: {party.pan!r}.")

    if party.bank_ifsc_code.strip() and not is_valid_ifsc(party.bank_ifsc_code):
        errors.append(f"Invalid IFSC code format: {party.bank_ifsc_code!r}.")

    if party.email.strip() and not is_valid_email(party.email):
        errors.append(f"Invalid email format: {party.email!r}.")

    _validate_non_negative(errors, "E-Way Bill distance", party.distance_for_eway_bill_km)
    _validate_non_negative(errors, "Credit Limit", party.credit_limit)
    if party.due_days is not None and party.due_days < 0:
        errors.append("Due Days cannot be negative.")
    _validate_non_negative(errors, "Customer Balance amount", party.customer_balance.amount)
    _validate_non_negative(errors, "Vendor Balance amount", party.vendor_balance.amount)

    return errors


def _validate_non_negative(errors: list[str], label: str, value: Decimal | None) -> None:
    if value is not None and value < 0:
        errors.append(f"{label} cannot be negative.")
