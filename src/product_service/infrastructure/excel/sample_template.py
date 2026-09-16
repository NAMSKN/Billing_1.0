"""Sample template generator for Product / Service Excel import.

Generates a formatted, valid workbook covering Products, Services, and Additional Charges
with varying tax rates, pricing, stock types, units, discounts, and optional blank fields.
"""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from product_service.infrastructure.excel import columns as C

_SAMPLE_ROWS: list[list[object]] = [
    # 1. Product - Normal stock, 18% tax, Rupee discount, PCS unit
    [
        "Product",
        "Precision Injection Mould",
        "High quality aluminium mould",
        "SMPL-PRD-001",
        "84807100",
        "PCS",
        Decimal("18"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("25000.00"),
        Decimal("29500.00"),
        "Rupee",
        Decimal("500.00"),
        Decimal("18000.00"),
        Decimal("21240.00"),
        "Rupee",
        Decimal("0"),
        "Normal",
        Decimal("10"),
        Decimal("2"),
        "Moulds",
        "Yes",
        "No",
        "Yes",
    ],
    # 2. Product - Batch stock, 12% tax, Percentage discount, KG unit, blank notes/group
    [
        "Product",
        "CNC Machined Core Pin",
        "",
        "SMPL-PRD-002",
        "8480",
        "KG",
        Decimal("12"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("1200.00"),
        Decimal("1344.00"),
        "Percentage",
        Decimal("5"),
        Decimal("850.00"),
        Decimal("952.00"),
        "Percentage",
        Decimal("2"),
        "Batch",
        Decimal("100"),
        Decimal("15"),
        "",
        "Yes",
        "No",
        "No",
    ],
    # 3. Product - Serial No. stock, 28% tax + CESS %, NOS unit, blank barcode
    [
        "Product",
        "Hydraulic Core Puller",
        "Heavy duty puller",
        "",
        "8412",
        "NOS",
        Decimal("28"),
        Decimal("1"),
        "Fixed",
        Decimal("100.00"),
        "No",
        Decimal("45000.00"),
        Decimal("57600.00"),
        "Rupee",
        Decimal("1000.00"),
        Decimal("35000.00"),
        Decimal("44800.00"),
        "Rupee",
        Decimal("500.00"),
        "Serial No.",
        Decimal("5"),
        Decimal("1"),
        "Machinery",
        "No",
        "No",
        "Yes",
    ],
    # 4. Service - 18% tax, HRS unit, blank stock fields
    [
        "Service",
        "EDM Wire Cutting Service",
        "Per hour machining charge",
        "",
        "9988",
        "HRS",
        Decimal("18"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("800.00"),
        Decimal("944.00"),
        "Percentage",
        Decimal("10"),
        Decimal("500.00"),
        Decimal("590.00"),
        "Rupee",
        Decimal("0"),
        "",
        "",
        "",
        "Job Work",
        "No",
        "No",
        "Yes",
    ],
    # 5. Service - 0% tax, blank unit, blank stock fields
    [
        "Service",
        "Mould Inspection & Testing",
        "Quality certification service",
        "",
        "9983",
        "",
        Decimal("0"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("3000.00"),
        Decimal("3000.00"),
        "Rupee",
        Decimal("0"),
        Decimal("1500.00"),
        Decimal("1500.00"),
        "Rupee",
        Decimal("0"),
        "",
        "",
        "",
        "",
        "No",
        "No",
        "No",
    ],
    # 6. Additional Charges - 5% tax, Freight charge, blank stock fields
    [
        "Additional Charges",
        "Freight & Transport Charges",
        "Logistics delivery charge",
        "",
        "9965",
        "",
        Decimal("5"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("1500.00"),
        Decimal("1575.00"),
        "Rupee",
        Decimal("0"),
        Decimal("1200.00"),
        Decimal("1260.00"),
        "Rupee",
        Decimal("0"),
        "",
        "",
        "",
        "",
        "No",
        "No",
        "Yes",
    ],
    # 7. Additional Charges - 18% tax, Packing charge, BOX unit, blank stock fields
    [
        "Additional Charges",
        "Wooden Crate Packing",
        "Protective export packaging",
        "",
        "9988",
        "BOX",
        Decimal("18"),
        Decimal("0"),
        "Fixed",
        Decimal("0"),
        "No",
        Decimal("2500.00"),
        Decimal("2950.00"),
        "Rupee",
        Decimal("0"),
        Decimal("2000.00"),
        Decimal("2360.00"),
        "Rupee",
        Decimal("0"),
        "",
        "",
        "",
        "",
        "No",
        "No",
        "Yes",
    ],
]


def generate_sample_workbook() -> Workbook:
    """Create a formatted workbook containing sample product/service/charges rows."""
    wb = Workbook()
    sheet = wb.active
    sheet.title = "Sample Products & Services"

    # Header row
    sheet.append(list(C.EXPORT_COLUMNS))
    for cell in sheet[1]:
        cell.font = Font(bold=True)

    # Freeze header row
    sheet.freeze_panes = "A2"

    # Sample rows
    for row in _SAMPLE_ROWS:
        sheet.append(row)

    # Column widths
    for col_idx, col in enumerate(sheet.columns, start=1):
        max_len = 0
        for cell in col:
            val = cell.value
            val_str = "" if val is None else str(val)
            if len(val_str) > max_len:
                max_len = len(val_str)
        col_letter = get_column_letter(col_idx)
        sheet.column_dimensions[col_letter].width = max(max_len + 3, 12)

    return wb


def write_sample_excel(output_path: str | Path, *, overwrite: bool = True) -> Path:
    """Write the sample template to output_path."""
    path = Path(output_path)
    if path.exists() and not overwrite:
        raise FileExistsError(f"File already exists: {path}")

    wb = generate_sample_workbook()
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(path))
    return path
