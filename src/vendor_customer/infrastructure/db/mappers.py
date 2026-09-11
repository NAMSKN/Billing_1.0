"""Row <-> domain-model mapping for the party master (persistence boundary).

Conversions between exact storage representations (UUID TEXT, INTEGER paise,
decimal-as-TEXT) and domain models (UUID, Decimal) happen here only. Money is
stored as integer paise and quantities/percentages are not used by parties.
UUIDs are canonical lowercase TEXT (DECISIONS D-024).
"""

from __future__ import annotations

import sqlite3
import uuid
from decimal import Decimal

from invoice_generator.domain.ids import to_canonical
from invoice_generator.domain.money import from_paise, to_paise
from vendor_customer.domain.models import (
    BalanceType,
    OpeningBalance,
    Party,
    PartyAddress,
    PartyGroup,
    PartyType,
    RegistrationType,
)


def _uid_opt(value: uuid.UUID | None) -> str | None:
    return None if value is None else to_canonical(value)


def _decimal_opt_to_text(value: Decimal | None) -> str | None:
    return None if value is None else str(value)


def _text_to_decimal_opt(value: str | None) -> Decimal | None:
    return None if value is None or value == "" else Decimal(value)


def _paise_opt_to(value: Decimal | None) -> int | None:
    return None if value is None else to_paise(value)


def _paise_opt_from(value: int | None) -> Decimal | None:
    return None if value is None else from_paise(int(value))


def party_to_row(p: Party) -> dict[str, object]:
    """Serialize a :class:`Party` to a column dict for INSERT/REPLACE."""
    ship = p.shipping_address
    has_ship = ship is not None
    ship = ship or PartyAddress()
    return {
        "id": to_canonical(p.id),
        "company_id": None,
        "company_type": p.company_type.value,
        "company_name": p.company_name,
        "contact_person": p.contact_person,
        "contact_no": p.contact_no,
        "email": p.email,
        "registration_type": p.registration_type.value,
        "gstin": p.gstin,
        "pan": p.pan,
        "bill_address1": p.billing_address.address1,
        "bill_address2": p.billing_address.address2,
        "bill_landmark": p.billing_address.landmark,
        "bill_country": p.billing_address.country,
        "bill_state": p.billing_address.state,
        "bill_state_code": p.billing_address.state_code,
        "bill_city": p.billing_address.city,
        "bill_pincode": p.billing_address.pincode,
        "has_shipping": 1 if has_ship else 0,
        "ship_address1": ship.address1,
        "ship_address2": ship.address2,
        "ship_landmark": ship.landmark,
        "ship_country": ship.country,
        "ship_state": ship.state,
        "ship_state_code": ship.state_code,
        "ship_city": ship.city,
        "ship_pincode": ship.pincode,
        "distance_for_eway_bill_km": _decimal_opt_to_text(p.distance_for_eway_bill_km),
        "group_id": _uid_opt(p.group_id),
        "bank_name": p.bank_name,
        "bank_ifsc_code": p.bank_ifsc_code,
        "bank_account_number": p.bank_account_number,
        "fax_no": p.fax_no,
        "website": p.website,
        "credit_limit_paise": _paise_opt_to(p.credit_limit),
        "due_days": p.due_days,
        "note": p.note,
        "visible_on_documents": 1 if p.visible_on_documents else 0,
        "custom_field_1": p.custom_field_1,
        "custom_field_2": p.custom_field_2,
        "custom_field_3": p.custom_field_3,
        "customer_balance_type": p.customer_balance.balance_type.value,
        "customer_balance_paise": to_paise(p.customer_balance.amount),
        "vendor_balance_type": p.vendor_balance.balance_type.value,
        "vendor_balance_paise": to_paise(p.vendor_balance.amount),
        "is_active": 1 if p.is_active else 0,
        "created_at": p.created_at,
        "updated_at": p.updated_at,
    }


def row_to_party(row: sqlite3.Row) -> Party:
    """Rehydrate a :class:`Party` from a ``parties`` row."""
    has_ship = bool(row["has_shipping"])
    shipping = (
        PartyAddress(
            address1=row["ship_address1"],
            address2=row["ship_address2"],
            landmark=row["ship_landmark"],
            country=row["ship_country"],
            state=row["ship_state"],
            state_code=row["ship_state_code"],
            city=row["ship_city"],
            pincode=row["ship_pincode"],
        )
        if has_ship
        else None
    )
    group_id = row["group_id"]
    return Party(
        id=uuid.UUID(row["id"]),
        company_type=PartyType(row["company_type"]),
        company_name=row["company_name"],
        contact_person=row["contact_person"],
        contact_no=row["contact_no"],
        email=row["email"],
        registration_type=RegistrationType(row["registration_type"]),
        gstin=row["gstin"],
        pan=row["pan"],
        billing_address=PartyAddress(
            address1=row["bill_address1"],
            address2=row["bill_address2"],
            landmark=row["bill_landmark"],
            country=row["bill_country"],
            state=row["bill_state"],
            state_code=row["bill_state_code"],
            city=row["bill_city"],
            pincode=row["bill_pincode"],
        ),
        shipping_address=shipping,
        distance_for_eway_bill_km=_text_to_decimal_opt(row["distance_for_eway_bill_km"]),
        group_id=uuid.UUID(group_id) if group_id else None,
        bank_name=row["bank_name"],
        bank_ifsc_code=row["bank_ifsc_code"],
        bank_account_number=row["bank_account_number"],
        fax_no=row["fax_no"],
        website=row["website"],
        credit_limit=_paise_opt_from(row["credit_limit_paise"]),
        due_days=row["due_days"],
        note=row["note"],
        visible_on_documents=bool(row["visible_on_documents"]),
        custom_field_1=row["custom_field_1"],
        custom_field_2=row["custom_field_2"],
        custom_field_3=row["custom_field_3"],
        customer_balance=OpeningBalance(
            balance_type=BalanceType(row["customer_balance_type"]),
            amount=from_paise(int(row["customer_balance_paise"])),
        ),
        vendor_balance=OpeningBalance(
            balance_type=BalanceType(row["vendor_balance_type"]),
            amount=from_paise(int(row["vendor_balance_paise"])),
        ),
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def group_to_row(g: PartyGroup) -> dict[str, object]:
    return {
        "id": to_canonical(g.id),
        "name": g.name,
        "is_active": 1 if g.is_active else 0,
    }


def row_to_group(row: sqlite3.Row) -> PartyGroup:
    return PartyGroup(
        id=uuid.UUID(row["id"]),
        name=row["name"],
        is_active=bool(row["is_active"]),
    )
