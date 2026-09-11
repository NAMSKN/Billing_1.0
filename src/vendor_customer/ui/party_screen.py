"""Party master screen widget for Vendor & Customer management."""

from __future__ import annotations

from typing import Optional, Sequence

from PySide6.QtWidgets import (
    QAbstractItemView,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from common.ui.ui_kit import StatusBanner
from vendor_customer.application.party_service import PartyService
from vendor_customer.domain.models import Party, PartyRole

_COLUMNS = ("Name", "Role", "GSTIN", "State", "Phone", "Email")


class PartyScreen(QWidget):
    """UI screen for viewing, filtering, and managing trading parties."""

    def __init__(self, service: PartyService) -> None:
        super().__init__()
        self._service = service
        self._parties: list[Party] = []

        layout = QVBoxLayout(self)

        title = QLabel("👥 Customers & Vendors")
        title.setObjectName("screenTitle")
        layout.addWidget(title)

        self.status = StatusBanner()
        layout.addWidget(self.status)

        # Filter bar
        filter_bar = QHBoxLayout()
        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search by name, GSTIN, phone...")
        self.search_input.textChanged.connect(self._apply_filter)
        filter_bar.addWidget(self.search_input)

        self.role_filter = QComboBox()
        self.role_filter.addItems(["All Roles", "Customers", "Vendors", "Both"])
        self.role_filter.currentIndexChanged.connect(self._apply_filter)
        filter_bar.addWidget(self.role_filter)

        self.refresh_btn = QPushButton("Refresh")
        self.refresh_btn.clicked.connect(self.reload)
        filter_bar.addWidget(self.refresh_btn)

        layout.addLayout(filter_bar)

        # Table
        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        layout.addWidget(self.table)

        self.reload()

    def reload(self) -> None:
        self._parties = list(self._service.list_parties(include_inactive=False))
        self._apply_filter()

    def _apply_filter(self) -> None:
        text = self.search_input.text().strip().lower()
        role_idx = self.role_filter.currentIndex()

        filtered = self._parties
        if role_idx == 1:
            filtered = [p for p in filtered if p.role in (PartyRole.CUSTOMER, PartyRole.BOTH)]
        elif role_idx == 2:
            filtered = [p for p in filtered if p.role in (PartyRole.VENDOR, PartyRole.BOTH)]
        elif role_idx == 3:
            filtered = [p for p in filtered if p.role == PartyRole.BOTH]

        if text:
            filtered = [
                p
                for p in filtered
                if text in p.display_name.lower()
                or text in p.gstin.lower()
                or text in p.phone.lower()
            ]

        self.table.setRowCount(len(filtered))
        for row_idx, p in enumerate(filtered):
            self.table.setItem(row_idx, 0, QTableWidgetItem(p.display_name))
            self.table.setItem(row_idx, 1, QTableWidgetItem(p.role.value))
            self.table.setItem(row_idx, 2, QTableWidgetItem(p.gstin or "—"))
            self.table.setItem(row_idx, 3, QTableWidgetItem(p.billing_address.state or "—"))
            self.table.setItem(row_idx, 4, QTableWidgetItem(p.phone or "—"))
            self.table.setItem(row_idx, 5, QTableWidgetItem(p.email or "—"))
