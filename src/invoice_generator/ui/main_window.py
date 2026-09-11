"""Main application window: navigation shell hosting the real screens.

Provides the window frame and a sidebar that switches a stacked view between the
Dashboard, Customers, Create/Edit Invoice, Invoice History, and Settings screens
(Req 25.1). Each screen is the real widget, constructed with a controller built
from the wired :class:`Application` (DECISIONS D-021). The window performs no SQL
and no calculations; it only wires navigation and hands services to screens.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QHBoxLayout,
    QListWidget,
    QMainWindow,
    QStackedWidget,
    QWidget,
)

from invoice_generator.bootstrap import Application
from invoice_generator.ui.customers.customer_controller import CustomerController
from invoice_generator.ui.customers.customer_screen import CustomerScreen
from invoice_generator.ui.dashboard.dashboard_controller import DashboardController
from invoice_generator.ui.dashboard.dashboard_screen import DashboardScreen
from invoice_generator.ui.invoices.invoice_form import InvoiceForm
from invoice_generator.ui.invoices.invoice_form_controller import InvoiceFormController
from invoice_generator.ui.invoices.invoice_list import InvoiceListScreen
from invoice_generator.ui.invoices.invoice_list_controller import InvoiceListController
from invoice_generator.ui.settings.settings_controller import SettingsController
from invoice_generator.ui.settings.settings_screen import SettingsScreen

# Screen order in both the sidebar and the stack (Req 25.1).
SCREENS: tuple[str, ...] = (
    "Dashboard",
    "Customers",
    "Create / Edit Invoice",
    "Invoice History",
    "Settings",
)


class MainWindow(QMainWindow):
    """Top-level window hosting the navigation sidebar and the real screens."""

    def __init__(self, app: Application) -> None:
        super().__init__()
        self._app = app
        self.setWindowTitle("Invoice Generator")
        self.resize(1024, 720)

        self._nav = QListWidget()
        self._nav.addItems(list(SCREENS))
        self._nav.setFixedWidth(200)

        self._stack = QStackedWidget()
        self._screens: dict[str, QWidget] = self._build_screens(app)
        for name in SCREENS:
            self._stack.addWidget(self._screens[name])

        self._nav.currentRowChanged.connect(self._stack.setCurrentIndex)
        self._nav.setCurrentRow(0)

        central = QWidget()
        layout = QHBoxLayout(central)
        layout.addWidget(self._nav)
        layout.addWidget(self._stack, stretch=1)
        self.setCentralWidget(central)

    def _build_screens(self, app: Application) -> dict[str, QWidget]:
        """Construct the real screens with controllers from the wired app."""
        dashboard = DashboardScreen(DashboardController(app))
        dashboard.new_invoice_requested.connect(self._on_new_invoice)
        return {
            "Dashboard": dashboard,
            "Customers": CustomerScreen(CustomerController(app.customer_service_repo)),
            "Create / Edit Invoice": InvoiceForm(InvoiceFormController(app)),
            "Invoice History": InvoiceListScreen(InvoiceListController(app)),
            "Settings": SettingsScreen(self._settings_controller(app)),
        }

    def _settings_controller(self, app: Application) -> SettingsController:
        from invoice_generator.config import get_app_paths
        from invoice_generator.infrastructure.assets.asset_store import AssetStore
        from invoice_generator.infrastructure.db.asset_repository import SqliteAssetRepository

        return SettingsController(
            app.company_service_repo,
            SqliteAssetRepository(app.connection),
            app.settings_service,
            AssetStore(get_app_paths().assets_dir),
        )

    def _on_new_invoice(self) -> None:
        self.go_to("Create / Edit Invoice")

    @property
    def application(self) -> Application:
        return self._app

    def current_screen_name(self) -> str:
        return SCREENS[self._stack.currentIndex()]

    def go_to(self, screen_name: str) -> None:
        """Navigate to a screen by name (raises ValueError if unknown)."""
        index = SCREENS.index(screen_name)
        self._nav.setCurrentRow(index)


__all__ = ["MainWindow", "SCREENS"]
