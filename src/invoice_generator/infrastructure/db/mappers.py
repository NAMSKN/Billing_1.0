"""Row <-> domain-model mapping for SQLite repositories.

Conversions between exact storage representations (UUID TEXT, INTEGER paise/
millis/hundredths) and domain models (UUID, Decimal) happen here, at the
persistence boundary only (design sections 3, 8). No precision is lost:
money uses paise, quantity uses millis, percentages use hundredths (DECISIONS
D-004/D-005), and UUIDs use canonical text (D-024).
"""

from __future__ import annotations

import sqlite3
import uuid
from decimal import Decimal

from invoice_generator.domain.enums import InvoiceStatus, PaymentStatus, TaxTreatment
from invoice_generator.domain.ids import parse_uuid, to_canonical
from invoice_generator.domain.models import (
    Address,
    Asset,
    Company,
    Customer,
    InvoiceLine,
    SequenceState,
)
from invoice_generator.domain.money import (
    from_hundredths,
    from_millis,
    from_paise,
    to_hundredths,
    to_millis,
    to_paise,
)


def uid(value: uuid.UUID) -> str:
    """Serialize a UUID to canonical text for storage."""
    return to_canonical(value)


def uid_opt(value: uuid.UUID | None) -> str | None:
    return None if value is None else to_canonical(value)


def parse_uid(value: str) -> uuid.UUID:
    return parse_uuid(value)


def parse_uid_opt(value: str | None) -> uuid.UUID | None:
    return None if value is None else parse_uuid(value)


# --- Company ---


def company_to_row(c: Company) -> dict[str, object]:
    return {
        "id": uid(c.id),
        "name": c.name,
        "address_line": c.address.line,
        "state_name": c.address.state_name,
        "state_code": c.address.state_code,
        "gstin": c.gstin,
        "email": c.email,
        "phone": c.phone,
        "bank_name": c.bank_name,
        "account_number": c.account_number,
        "branch": c.branch,
        "ifsc": c.ifsc,
        "upi_id": c.upi_id,
        "authorized_signatory": c.authorized_signatory,
        "logo_asset_id": uid_opt(c.logo_asset_id),
        "signature_asset_id": uid_opt(c.signature_asset_id),
        "active": 1 if c.active else 0,
    }


def row_to_company(row: sqlite3.Row) -> Company:
    return Company(
        id=parse_uid(row["id"]),
        name=row["name"],
        address=Address(
            line=row["address_line"],
            state_name=row["state_name"],
            state_code=row["state_code"],
        ),
        gstin=row["gstin"],
        email=row["email"],
        phone=row["phone"],
        bank_name=row["bank_name"],
        account_number=row["account_number"],
        branch=row["branch"],
        ifsc=row["ifsc"],
        upi_id=row["upi_id"],
        authorized_signatory=row["authorized_signatory"],
        logo_asset_id=parse_uid_opt(row["logo_asset_id"]),
        signature_asset_id=parse_uid_opt(row["signature_asset_id"]),
        active=bool(row["active"]),
    )


# --- Customer ---


def customer_to_row(c: Customer) -> dict[str, object]:
    return {
        "id": uid(c.id),
        "company_id": None,
        "name": c.name,
        "gstin": c.gstin,
        "phone": c.phone,
        "email": c.email,
        "bill_line": c.bill_to.line,
        "bill_state_name": c.bill_to.state_name,
        "bill_state_code": c.bill_to.state_code,
        "bill_godown": c.bill_to.godown,
        "ship_line": c.ship_to.line,
        "ship_state_name": c.ship_to.state_name,
        "ship_state_code": c.ship_to.state_code,
        "ship_godown": c.ship_to.godown,
        "is_active": 1 if c.is_active else 0,
    }


def row_to_customer(row: sqlite3.Row) -> Customer:
    return Customer(
        id=parse_uid(row["id"]),
        name=row["name"],
        gstin=row["gstin"],
        phone=row["phone"],
        email=row["email"],
        bill_to=Address(
            line=row["bill_line"],
            state_name=row["bill_state_name"],
            state_code=row["bill_state_code"],
            godown=row["bill_godown"],
        ),
        ship_to=Address(
            line=row["ship_line"],
            state_name=row["ship_state_name"],
            state_code=row["ship_state_code"],
            godown=row["ship_godown"],
        ),
        is_active=bool(row["is_active"]),
    )


# --- Asset ---


def asset_to_row(a: Asset) -> dict[str, object]:
    return {
        "id": uid(a.id),
        "kind": a.kind,
        "version": a.version,
        "sha256": a.sha256,
        "stored_path": a.stored_path,
        "created_at": a.created_at,
    }


def row_to_asset(row: sqlite3.Row) -> Asset:
    return Asset(
        id=parse_uid(row["id"]),
        kind=row["kind"],
        version=int(row["version"]),
        sha256=row["sha256"],
        stored_path=row["stored_path"],
        created_at=row["created_at"],
    )


# --- SequenceState ---


def sequence_to_row(s: SequenceState) -> dict[str, object]:
    return {
        "company_id": uid(s.company_id),
        "financial_year": s.financial_year,
        "prefix": s.prefix,
        "next_sequence": s.next_sequence,
        "high_water_mark": s.high_water_mark,
    }


def row_to_sequence(row: sqlite3.Row) -> SequenceState:
    return SequenceState(
        company_id=parse_uid(row["company_id"]),
        financial_year=row["financial_year"],
        prefix=row["prefix"],
        next_sequence=int(row["next_sequence"]),
        high_water_mark=int(row["high_water_mark"]),
    )


# --- InvoiceLine ---


def line_to_row(line: InvoiceLine, invoice_id: uuid.UUID) -> dict[str, object]:
    return {
        "id": uid(line.id),
        "invoice_id": uid(invoice_id),
        "sequence": line.sequence,
        "job_or_mould_reference": line.job_or_mould_reference,
        "component_or_part": line.component_or_part,
        "operation": line.operation,
        "description": line.description,
        "specification": line.specification,
        "hsn_sac": line.hsn_sac,
        "quantity_millis": to_millis(line.quantity),
        "unit": line.unit,
        "rate_paise": to_paise(line.rate),
        "discount_hundredths": to_hundredths(line.discount_percent),
        "tax_treatment": line.tax_treatment.value,
        "tax_rate_hundredths": to_hundredths(line.tax_rate),
        "taxable_paise": None if line.taxable_amount is None else to_paise(line.taxable_amount),
        "cgst_paise": None if line.cgst_amount is None else to_paise(line.cgst_amount),
        "sgst_paise": None if line.sgst_amount is None else to_paise(line.sgst_amount),
        "igst_paise": None if line.igst_amount is None else to_paise(line.igst_amount),
    }


def _money_or_none(paise: int | None) -> Decimal | None:
    return None if paise is None else from_paise(int(paise))


def row_to_line(row: sqlite3.Row) -> InvoiceLine:
    return InvoiceLine(
        id=parse_uid(row["id"]),
        sequence=int(row["sequence"]),
        job_or_mould_reference=row["job_or_mould_reference"],
        component_or_part=row["component_or_part"],
        operation=row["operation"],
        description=row["description"],
        specification=row["specification"],
        hsn_sac=row["hsn_sac"],
        quantity=from_millis(int(row["quantity_millis"])),
        unit=row["unit"],
        rate=from_paise(int(row["rate_paise"])),
        discount_percent=from_hundredths(int(row["discount_hundredths"])),
        tax_treatment=TaxTreatment(row["tax_treatment"]),
        tax_rate=from_hundredths(int(row["tax_rate_hundredths"])),
        taxable_amount=_money_or_none(row["taxable_paise"]),
        cgst_amount=_money_or_none(row["cgst_paise"]),
        sgst_amount=_money_or_none(row["sgst_paise"]),
        igst_amount=_money_or_none(row["igst_paise"]),
    )


# --- Enum helpers (validated on read) ---


def parse_invoice_status(value: str) -> InvoiceStatus:
    return InvoiceStatus(value)


def parse_payment_status(value: str) -> PaymentStatus:
    return PaymentStatus(value)
