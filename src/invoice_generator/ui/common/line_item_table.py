"""Editable line-item table widget (Task 48).

A reusable PySide6 table for entering mould/machining line items. It edits the
structured fields (job/mould, operation, description, specification, HSN/SAC,
quantity, unit, rate, discount%) and converts rows to/from
:class:`InvoiceLine` domain objects. It performs no calculations — the form
controller computes totals via the engine (DECISIONS D-006/D-021).

Emits :attr:`changed` whenever rows are added, removed, or edited so the form
can refresh live totals.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QHBoxLayout,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.domain.enums import TaxTreatment
from invoice_generator.domain.models import InvoiceLine

_COLUMNS = (
    "Job/Mould",
    "Operation",
    "Description",
    "Specification",
    "HSN/SAC",
    "Qty",
    "Unit",
    "Rate",
    "Disc %",
)
_DEFAULT_HSN = "998898"  # configurable default per Req 6.2; prefilled for new rows
_DEFAULT_UNIT = "NOS"


class LineItemTable(QWidget):
    changed = Signal()

    def __init__(self) -> None:
        super().__init__()
        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.itemChanged.connect(lambda _item: self.changed.emit())

        self.add_button = QPushButton("Add Line")
        self.remove_button = QPushButton("Remove Line")
        self.add_button.clicked.connect(self.add_row)
        self.remove_button.clicked.connect(self.remove_selected_row)

        layout = QVBoxLayout(self)
        layout.addWidget(self.table, stretch=1)
        buttons = QHBoxLayout()
        buttons.addWidget(self.add_button)
        buttons.addWidget(self.remove_button)
        layout.addLayout(buttons)

    def add_row(self) -> None:
        row = self.table.rowCount()
        self.table.insertRow(row)
        defaults = ("", "", "", "", _DEFAULT_HSN, "1", _DEFAULT_UNIT, "0.00", "0")
        for col, value in enumerate(defaults):
            self.table.setItem(row, col, QTableWidgetItem(value))
        self.changed.emit()

    def remove_selected_row(self) -> None:
        row = self.table.currentRow()
        if row >= 0:
            self.table.removeRow(row)
            self.changed.emit()

    def set_lines(self, lines: tuple[InvoiceLine, ...]) -> None:
        self.table.setRowCount(0)
        for line in lines:
            row = self.table.rowCount()
            self.table.insertRow(row)
            values = (
                line.job_or_mould_reference,
                line.operation,
                line.description,
                line.specification,
                line.hsn_sac,
                _fmt(line.quantity),
                line.unit,
                _fmt(line.rate),
                _fmt(line.discount_percent),
            )
            for col, value in enumerate(values):
                self.table.setItem(row, col, QTableWidgetItem(value))

    def collect_lines(self) -> tuple[InvoiceLine, ...]:
        lines: list[InvoiceLine] = []
        for row in range(self.table.rowCount()):
            lines.append(
                InvoiceLine(
                    sequence=row + 1,
                    job_or_mould_reference=self._cell(row, 0),
                    operation=self._cell(row, 1),
                    description=self._cell(row, 2),
                    specification=self._cell(row, 3),
                    hsn_sac=self._cell(row, 4),
                    quantity=_to_decimal(self._cell(row, 5), Decimal("0")),
                    unit=self._cell(row, 6),
                    rate=_to_decimal(self._cell(row, 7), Decimal("0")),
                    discount_percent=_to_decimal(self._cell(row, 8), Decimal("0")),
                    tax_treatment=TaxTreatment.TAXABLE,
                )
            )
        return tuple(lines)

    def _cell(self, row: int, col: int) -> str:
        item = self.table.item(row, col)
        return item.text().strip() if item is not None else ""


def _fmt(value: Decimal) -> str:
    return f"{value.normalize():f}"


def _to_decimal(text: str, default: Decimal) -> Decimal:
    try:
        return Decimal(text) if text else default
    except (InvalidOperation, ArithmeticError):
        return default


__all__ = ["LineItemTable"]
