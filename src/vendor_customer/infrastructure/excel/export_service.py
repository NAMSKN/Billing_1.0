"""Excel export for the party master (product rules, section 15).

The user first chooses a scope (Customers, Vendors, or Both). A CUSTOMER_VENDOR
party belongs to both categories, so it is included when exporting Customers and
when exporting Vendors, and appears exactly once when exporting Both. Optional
blank fields, numeric amounts, party type, state, GSTIN and balances are all
preserved. The internal UUID is not exported.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence
from decimal import Decimal
from enum import StrEnum
from pathlib import Path

from openpyxl import Workbook

from vendor_customer.domain.models import Party
from vendor_customer.infrastructure.excel import columns as C


class ExportScope(StrEnum):
    """Which parties to export (product rules, section 15)."""

    CUSTOMERS = "CUSTOMERS"
    VENDORS = "VENDORS"
    BOTH = "BOTH"


def select_for_scope(parties: Iterable[Party], scope: ExportScope) -> list[Party]:
    """Return parties matching ``scope`` with CUSTOMER_VENDOR handled once.

    - CUSTOMERS: parties whose type includes Customer (CUSTOMER, CUSTOMER_VENDOR).
    - VENDORS: parties whose type includes Vendor (VENDOR, CUSTOMER_VENDOR).
    - BOTH: every party, each exactly once.
    """
    result: list[Party] = []
    for party in parties:
        if scope is ExportScope.CUSTOMERS and not party.company_type.is_customer:
            continue
        if scope is ExportScope.VENDORS and not party.company_type.is_vendor:
            continue
        result.append(party)
    return result


class PartyExcelExporter:
    """Writes selected parties to a business-facing ``.xlsx`` workbook."""

    def __init__(self, group_name_resolver: Callable[[Party], str] | None = None) -> None:
        # Resolves a party's group name for the export cell; default is blank.
        self._group_name = group_name_resolver or (lambda _p: "")

    def export(
        self,
        parties: Sequence[Party],
        scope: ExportScope,
        output_path: str | Path,
        *,
        overwrite: bool = False,
    ) -> Path:
        """Export ``parties`` filtered by ``scope`` to ``output_path``.

        Refuses to overwrite an existing file unless ``overwrite`` is True
        (product rules: do not overwrite silently). Returns the written path.
        """
        path = Path(output_path)
        if path.exists() and not overwrite:
            raise FileExistsError(f"File already exists: {path}")

        selected = select_for_scope(parties, scope)
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Parties"
        sheet.append(list(C.EXPORT_COLUMNS))
        for party in selected:
            sheet.append(self._row_for(party))
        path.parent.mkdir(parents=True, exist_ok=True)
        workbook.save(str(path))
        return path

    def _row_for(self, party: Party) -> list[object]:
        billing = party.billing_address
        return [
            party.company_name,
            party.contact_person,
            party.contact_no,
            billing.address1,
            billing.address2,
            billing.landmark,
            billing.country,
            billing.state,
            billing.city,
            party.company_type.value,
            party.bank_name,
            party.bank_ifsc_code,
            party.bank_account_number,
            billing.pincode,
            party.fax_no,
            party.website,
            party.email,
            party.registration_type.label,
            party.gstin,
            party.pan,
            _decimal_cell(party.distance_for_eway_bill_km),
            self._group_name(party),
            party.custom_field_1,
            party.custom_field_2,
            party.custom_field_3,
            party.due_days if party.due_days is not None else "",
            party.note,
            party.customer_balance.balance_type.label,
            _decimal_cell(party.customer_balance.amount),
            party.vendor_balance.balance_type.label,
            _decimal_cell(party.vendor_balance.amount),
        ]


def _decimal_cell(value: Decimal | None) -> object:
    """Render an exact ``Decimal`` as a numeric cell, or blank when None.

    The Decimal is passed through unchanged (openpyxl writes it as a number);
    money is never converted to float (coding standards, DECISIONS D-004).
    """
    if value is None:
        return ""
    return value
