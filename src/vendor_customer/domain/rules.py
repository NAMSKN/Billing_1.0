"""Validation and domain rules for Vendor & Customer Management."""

from __future__ import annotations

import re

from vendor_customer.domain.models import Party, PartyRole

GSTIN_PATTERN = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$")
PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")
IFSC_PATTERN = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")


def is_valid_gstin(gstin: str) -> bool:
    """Check if the provided GSTIN matches the standard 15-character Indian format."""
    if not gstin:
        return False
    return bool(GSTIN_PATTERN.match(gstin.strip().upper()))


def extract_state_code(gstin: str) -> str:
    """Extract 2-digit state code from GSTIN."""
    clean = gstin.strip().upper()
    if len(clean) >= 2 and clean[:2].isdigit():
        return clean[:2]
    return ""


def extract_pan(gstin: str) -> str:
    """Extract 10-character PAN from characters 3-12 of GSTIN."""
    clean = gstin.strip().upper()
    if len(clean) >= 12:
        candidate = clean[2:12]
        if PAN_PATTERN.match(candidate):
            return candidate
    return ""


def is_valid_ifsc(ifsc: str) -> bool:
    """Check if the provided IFSC code matches the standard 11-character format."""
    if not ifsc:
        return False
    return bool(IFSC_PATTERN.match(ifsc.strip().upper()))


def validate_party(party: Party) -> list[str]:
    """Validate party domain entity and return list of validation error messages."""
    errors: list[str] = []

    if not party.display_name.strip():
        errors.append("Display name cannot be empty.")

    if party.gstin:
        clean_gstin = party.gstin.strip().upper()
        if not is_valid_gstin(clean_gstin):
            errors.append(f"Invalid GSTIN format: {party.gstin!r}.")

    if party.role in (PartyRole.VENDOR, PartyRole.BOTH):
        if party.bank_details and party.bank_details.ifsc_code:
            if not is_valid_ifsc(party.bank_details.ifsc_code):
                errors.append(f"Invalid IFSC code format: {party.bank_details.ifsc_code!r}.")

    return errors
