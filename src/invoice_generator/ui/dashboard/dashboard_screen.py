"""Dashboard screen widget (Task 51 + UI remediation phase 2).

An informative operational dashboard over :class:`DashboardController`: metric
cards (counts + finalized billing/GST totals), a recent-invoices table with an
Open action, an "Action required" panel (drafts to complete, pending payment,
recently cancelled), and quick actions. All data comes from the controller (no
SQL/calculations in the widget — DECISIONS D-021); metrics are computed from
persisted invoice totals.

References: requirements Req 25.1; DECISIONS D-015, D-021.
"""

from __future__ import annotations

from collections.abc import Sequence

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QAbstractItemView,
    QFrame,
    QGridLayout,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.application.render_dto import format_money
from invoice_generator.ui.common.navigation import Navigator
from invoice_generator.ui.common.ui_kit import make_primary, scrollable, title_label
from invoice_generator.ui.dashboard.dashboard_controller import DashboardController
from invoice_generator.ui.invoices.invoice_list_controller import InvoiceRow

_COLUMNS = ("Number", "Date", "Customer", "Amount", "Status", "Payment")


class _MetricCard(QFrame):
    """A white card showing a big value over a small label."""

    def __init__(self, label: str, *, accent: bool = False) -> None:
        super().__init__()
        self.setObjectName("metricCard")
        self.setFrameShape(QFrame.Shape.StyledPanel)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 10, 12, 10)
        self.value = QLabel("0")
        self.value.setObjectName("metricAccentRed" if accent else "metricValue")
        caption = QLabel(label)
        caption.setObjectName("metricLabel")
        layout.addWidget(self.value)
        layout.addWidget(caption)

    def set_value(self, text: str) -> None:
        self.value.setText(text)


class DashboardScreen(QWidget):
    new_invoice_requested = Signal()

    def __init__(
        self,
        controller: DashboardController,
        navigator: Navigator | None = None,
    ) -> None:
        super().__init__()
        self._controller = controller
        self._navigator = navigator
        self._rows: list[InvoiceRow] = []

        # Metric cards.
        self.card_total = _MetricCard("Total Invoices")
        self.card_drafts = _MetricCard("Drafts")
        self.card_finalized = _MetricCard("Finalized")
        self.card_pending = _MetricCard("Pending Payment", accent=True)
        self.card_billing = _MetricCard("Total Billing (Finalized)")
        self.card_gst = _MetricCard("GST Collected")

        # Recent invoices.
        self.search = QLineEdit()
        self.search.setPlaceholderText("Quick search (number or customer)")
        self.search.textChanged.connect(self._on_search)
        self.table = QTableWidget(0, len(_COLUMNS))
        self.table.setHorizontalHeaderLabels(list(_COLUMNS))
        self.table.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.itemDoubleClicked.connect(lambda _i: self.open_selected())
        self.table.itemSelectionChanged.connect(self._sync_open)
        header = self.table.horizontalHeader()
        if header is not None:
            header.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)

        self.open_button = QPushButton("Open / Continue")
        self.open_button.clicked.connect(self.open_selected)
        self.open_button.setEnabled(False)

        # Action-required panel.
        self.action_label = QLabel()
        self.action_label.setWordWrap(True)
        self.action_label.setTextFormat(Qt.TextFormat.RichText)

        # Quick actions.
        self.new_invoice_button = make_primary(QPushButton("New Invoice"))
        self.new_invoice_button.clicked.connect(self.new_invoice_requested.emit)
        self.customers_button = QPushButton("Customers")
        self.settings_button = QPushButton("Settings")
        self.customers_button.clicked.connect(lambda: self._go("Customers"))
        self.settings_button.clicked.connect(lambda: self._go("Settings"))

        self._build_layout()
        self.refresh()

    # --- layout ---

    def _build_layout(self) -> None:
        body = QWidget()
        inner = QVBoxLayout(body)
        inner.addWidget(title_label("Dashboard"))

        cards = QGridLayout()
        cards.setHorizontalSpacing(10)
        cards.setVerticalSpacing(10)
        for col, card in enumerate(
            (self.card_total, self.card_drafts, self.card_finalized, self.card_pending)
        ):
            cards.addWidget(card, 0, col)
        cards.addWidget(self.card_billing, 1, 0, 1, 2)
        cards.addWidget(self.card_gst, 1, 2, 1, 2)
        inner.addLayout(cards)

        quick = QHBoxLayout()
        quick.addWidget(self.new_invoice_button)
        quick.addWidget(self.customers_button)
        quick.addWidget(self.settings_button)
        quick.addStretch(1)
        inner.addLayout(quick)

        recent_title = QLabel("Recent Invoices (double-click to open)")
        recent_title.setObjectName("sectionTitle")
        inner.addWidget(recent_title)
        inner.addWidget(self.search)
        inner.addWidget(self.table, stretch=1)
        row_actions = QHBoxLayout()
        row_actions.addWidget(self.open_button)
        row_actions.addStretch(1)
        inner.addLayout(row_actions)

        action_title = QLabel("Action Required")
        action_title.setObjectName("sectionTitle")
        inner.addWidget(action_title)
        inner.addWidget(self.action_label)

        outer = QVBoxLayout(self)
        area = scrollable(body)
        area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        assert isinstance(area, QScrollArea)
        outer.addWidget(area, stretch=1)

    # --- navigation ---

    def _go(self, screen: str) -> None:
        if self._navigator is not None:
            self._navigator.go_to(screen)

    def open_selected(self) -> bool:
        row = self.table.currentRow()
        if not (0 <= row < len(self._rows)) or self._navigator is None:
            return False
        self._navigator.open_invoice(self._rows[row].invoice_id)
        return True

    def _sync_open(self) -> None:
        row = self.table.currentRow()
        self.open_button.setEnabled(0 <= row < len(self._rows))

    # --- data ---

    def refresh(self) -> None:
        """Reload metric cards, the action-required panel, and recent invoices."""
        m = self._controller.metrics()
        self.card_total.set_value(str(m.total))
        self.card_drafts.set_value(str(m.draft))
        self.card_finalized.set_value(str(m.finalized))
        self.card_pending.set_value(str(m.pending_payment))
        self.card_billing.set_value(format_money(m.finalized_grand_total))
        self.card_gst.set_value(format_money(m.finalized_tax))
        self._render_actions()
        self._show(self._controller.recent_invoices())

    def _render_actions(self) -> None:
        m = self._controller.metrics()
        items: list[str] = []
        if m.draft:
            items.append(f"\u2022 {m.draft} draft invoice(s) awaiting completion")
        if m.pending_payment:
            items.append(f"\u2022 {m.pending_payment} finalized invoice(s) pending payment")
        if m.cancelled:
            items.append(f"\u2022 {m.cancelled} cancelled invoice(s) on record")
        if self._controller.company_missing():
            items.append("\u2022 Company details are incomplete \u2014 open Settings to configure")
        if not items:
            self.action_label.setText("<i>Nothing needs attention right now.</i>")
        else:
            self.action_label.setText("<br>".join(items))

    def _on_search(self, text: str) -> None:
        self._show(self._controller.quick_search(text))

    def _show(self, rows: Sequence[InvoiceRow]) -> None:
        self._rows = list(rows)
        self.table.setRowCount(len(self._rows))
        for row, item in enumerate(self._rows):
            values = (
                item.number,
                item.date,
                item.customer,
                item.total,
                item.status,
                item.payment_status,
            )
            for col, value in enumerate(values):
                cell = QTableWidgetItem(value)
                cell.setToolTip(value)
                self.table.setItem(row, col, cell)
        self._sync_open()


__all__ = ["DashboardScreen"]
