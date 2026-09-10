"""Main application window: navigation shell for the five screens (Task 44).

Provides the window frame, a sidebar that switches a stacked view between the
Dashboard, Customers, Create/Edit Invoice, Invoice History, and Settings
screens (Req 25.1), and holds the wired :class:`Application` so screens can call
services. This task installs placeholder screens; the real screens arrive in
Tasks 46-51.

The window contains no SQL and no calculations (DECISIONS D-021): it only wires
navigation and holds references to services.
"""

from __future__ import annotations

from PySide6.QtWidgets import (
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMainWindow,
    QStackedWidget,
    QVBoxLayout,
    QWidget,
)

from invoice_generator.bootstrap import Application

# Screen order in both the sidebar and the stack (Req 25.1).
SCREENS: tuple[str, ...] = (
    "Dashboard",
    "Customers",
    "Create / Edit Invoice",
    "Invoice History",
    "Settings",
)


class _PlaceholderScreen(QWidget):
    """Temporary screen shown until the real screen is implemented."""

    def __init__(self, title: str) -> None:
        super().__init__()
        layout = QVBoxLayout(self)
        label = QLabel(f"{title}\n(coming soon)")
        label.setObjectName("placeholderLabel")
        layout.addWidget(label)
        layout.addStretch(1)


class MainWindow(QMainWindow):
    """Top-level window hosting the navigation sidebar and stacked screens."""

    def __init__(self, app: Application) -> None:
        super().__init__()
        self._app = app
        self.setWindowTitle("Invoice Generator")
        self.resize(1024, 720)

        self._nav = QListWidget()
        self._nav.addItems(list(SCREENS))
        self._nav.setFixedWidth(200)

        self._stack = QStackedWidget()
        for name in SCREENS:
            self._stack.addWidget(_PlaceholderScreen(name))

        self._nav.currentRowChanged.connect(self._stack.setCurrentIndex)
        self._nav.setCurrentRow(0)

        central = QWidget()
        layout = QHBoxLayout(central)
        layout.addWidget(self._nav)
        layout.addWidget(self._stack, stretch=1)
        self.setCentralWidget(central)

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
