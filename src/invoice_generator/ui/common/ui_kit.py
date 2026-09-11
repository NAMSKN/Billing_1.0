"""Shared UI kit: stylesheet, scroll wrapper, and status banner (UI remediation).

Presentation-only helpers used across screens to give a consistent, professional
look for a desktop billing operator: a single application stylesheet (spacing,
typography, button hierarchy, table styling), a helper to make any screen body
scrollable so content never clips at small window sizes, and a small status
banner for success/error/empty feedback. No business logic here.
"""

from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QFrame,
    QLabel,
    QPushButton,
    QScrollArea,
    QWidget,
)

# Application stylesheet. Neutral, print-shop professional; not decorative.
# One intentional LIGHT theme. Palette: white / black / red / yellow / light gray.
# Red and yellow are used only as accents (primary/danger actions, active nav,
# warnings). No dark backgrounds, no blue/purple, no gradients.
_WHITE = "#ffffff"
_BLACK = "#1a1a1a"
_RED = "#c62828"
_RED_DARK = "#a71d1d"
_YELLOW = "#f6c445"
_GRAY_BORDER = "#d0d0d0"
_GRAY_SURFACE = "#f4f4f4"
_GRAY_DISABLED = "#9a9a9a"

APP_STYLESHEET = f"""
QWidget {{ font-size: 10pt; color: {_BLACK}; background: {_WHITE}; }}
QMainWindow, QDialog {{ background: {_WHITE}; }}

/* Titles / sections */
QLabel#screenTitle {{ font-size: 16pt; font-weight: 700; padding: 2px 0 10px 0; color: {_BLACK}; }}
QLabel#sectionTitle {{ font-size: 11pt; font-weight: 700; color: {_BLACK}; }}

/* Panels / cards */
QGroupBox {{
    font-weight: 700;
    border: 1px solid {_GRAY_BORDER};
    border-radius: 6px;
    margin-top: 12px;
    padding: 10px;
    background: {_WHITE};
}}
QGroupBox::title {{ subcontrol-origin: margin; left: 10px; padding: 0 4px; }}
QFrame#card {{
    background: {_WHITE};
    border: 1px solid {_GRAY_BORDER};
    border-radius: 8px;
}}

/* Sidebar / navigation */
QListWidget#navSidebar {{
    background: {_GRAY_SURFACE};
    border: none;
    border-right: 1px solid {_GRAY_BORDER};
}}
QListWidget#navSidebar::item {{ padding: 12px 14px; color: {_BLACK}; }}
QListWidget#navSidebar::item:selected {{
    background: {_WHITE};
    color: {_RED};
    border-left: 3px solid {_RED};
    font-weight: 700;
}}
QListWidget#navSidebar::item:hover {{ background: #ededed; }}

/* Buttons */
QPushButton {{
    padding: 6px 14px;
    border: 1px solid {_GRAY_BORDER};
    border-radius: 5px;
    background: {_GRAY_SURFACE};
    color: {_BLACK};
}}
QPushButton:hover {{ background: #e9e9e9; }}
QPushButton:focus {{ border: 2px solid {_RED}; }}
QPushButton:disabled {{ color: {_GRAY_DISABLED}; background: #f0f0f0; border-color: #e0e0e0; }}
QPushButton#primary {{
    background: {_RED};
    color: {_WHITE};
    border: 1px solid {_RED};
    font-weight: 700;
}}
QPushButton#primary:hover {{ background: {_RED_DARK}; }}
QPushButton#primary:disabled {{ background: #e3b1b1; border-color: #e3b1b1; color: {_WHITE}; }}
QPushButton#danger {{ color: {_RED}; border: 1px solid {_RED}; background: {_WHITE}; }}
QPushButton#danger:hover {{ background: #fbe9e9; }}

/* Inputs */
QLineEdit, QComboBox, QDateEdit, QAbstractSpinBox {{
    padding: 4px 6px;
    border: 1px solid {_GRAY_BORDER};
    border-radius: 4px;
    min-height: 20px;
    background: {_WHITE};
    color: {_BLACK};
}}
QLineEdit:focus, QComboBox:focus, QDateEdit:focus {{ border: 2px solid {_RED}; }}
QLineEdit:disabled, QComboBox:disabled {{ background: #f2f2f2; color: {_GRAY_DISABLED}; }}
QComboBox QAbstractItemView {{
    background: {_WHITE};
    color: {_BLACK};
    selection-background-color: {_RED};
    selection-color: {_WHITE};
}}

/* Generic lists */
QListWidget {{ border: 1px solid {_GRAY_BORDER}; background: {_WHITE}; }}
QListWidget::item {{ padding: 6px 8px; }}
QListWidget::item:selected {{ background: {_RED}; color: {_WHITE}; }}

/* Tables */
QTableWidget, QTableView {{
    gridline-color: {_GRAY_BORDER};
    background: {_WHITE};
    alternate-background-color: #fafafa;
    selection-background-color: {_RED};
    selection-color: {_WHITE};
}}
QHeaderView::section {{
    background: {_GRAY_SURFACE};
    color: {_BLACK};
    padding: 5px 6px;
    border: none;
    border-right: 1px solid {_GRAY_BORDER};
    border-bottom: 1px solid {_GRAY_BORDER};
    font-weight: 700;
}}

/* Status banners */
QLabel#statusOk {{ color: #1a7f37; font-weight: 700; }}
QLabel#statusError {{ color: {_RED}; font-weight: 700; }}
QLabel#statusMuted {{ color: #555555; }}
QLabel#statusWarn {{ color: #8a6d00; font-weight: 700; background: {_YELLOW}; padding: 2px 6px; }}
QLabel#totalsGrand {{ font-size: 14pt; font-weight: 800; color: {_BLACK}; }}

/* Dashboard metric cards */
QFrame#metricCard {{
    background: {_WHITE};
    border: 1px solid {_GRAY_BORDER};
    border-radius: 8px;
}}
QLabel#metricValue {{ font-size: 20pt; font-weight: 800; color: {_BLACK}; }}
QLabel#metricLabel {{ font-size: 9pt; color: #555555; }}
QLabel#metricAccentRed {{ font-size: 20pt; font-weight: 800; color: {_RED}; }}

/* Scrollbars */
QScrollBar:vertical {{ background: {_WHITE}; width: 12px; margin: 0; }}
QScrollBar::handle:vertical {{ background: #cfcfcf; border-radius: 6px; min-height: 24px; }}
QScrollBar::handle:vertical:hover {{ background: #b8b8b8; }}
QScrollBar:horizontal {{ background: {_WHITE}; height: 12px; margin: 0; }}
QScrollBar::handle:horizontal {{ background: #cfcfcf; border-radius: 6px; min-width: 24px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ width: 0; height: 0; }}

/* Tabs */
QTabWidget::pane {{ border: 1px solid {_GRAY_BORDER}; background: {_WHITE}; }}
QTabBar::tab {{ background: {_GRAY_SURFACE}; padding: 6px 12px; border: 1px solid {_GRAY_BORDER}; }}
QTabBar::tab:selected {{ background: {_WHITE}; color: {_RED}; font-weight: 700; }}
"""


def horizontal_bar(widgets: object) -> QWidget:
    """Wrap widgets in a horizontally scrollable bar so they never force width.

    Useful for toolbars/action rows that would otherwise widen a screen past a
    small window. Widgets keep their natural size; the bar scrolls if needed.
    """
    from PySide6.QtWidgets import QHBoxLayout

    inner = QWidget()
    row = QHBoxLayout(inner)
    row.setContentsMargins(0, 0, 0, 0)
    for w in widgets:  # type: ignore[attr-defined]
        row.addWidget(w)
    area = QScrollArea()
    area.setWidgetResizable(True)
    area.setFrameShape(QFrame.Shape.NoFrame)
    area.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
    area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
    area.setFixedHeight(inner.sizeHint().height() + 4)
    area.setWidget(inner)
    return area


def scrollable(body: QWidget) -> QScrollArea:
    """Wrap ``body`` in a vertical scroll area so it never clips when small."""
    area = QScrollArea()
    area.setWidgetResizable(True)
    area.setFrameShape(QFrame.Shape.NoFrame)
    area.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
    area.setWidget(body)
    return area


class StatusBanner(QLabel):
    """A one-line status message with success/error/muted styling."""

    def __init__(self, text: str = "") -> None:
        super().__init__(text)
        self.setWordWrap(True)
        self.setObjectName("statusMuted")

    def clear_status(self) -> None:
        self.setText("")

    def show_ok(self, message: str) -> None:
        self.setObjectName("statusOk")
        self._restyle()
        self.setText(message)

    def show_error(self, message: str) -> None:
        self.setObjectName("statusError")
        self._restyle()
        self.setText(message)

    def show_info(self, message: str) -> None:
        self.setObjectName("statusMuted")
        self._restyle()
        self.setText(message)

    def _restyle(self) -> None:
        # Re-apply the stylesheet so the objectName-based rule takes effect.
        style = self.style()
        if style is not None:
            style.unpolish(self)
            style.polish(self)


def make_primary(button: QPushButton) -> QPushButton:
    button.setObjectName("primary")
    return button


def make_danger(button: QPushButton) -> QPushButton:
    button.setObjectName("danger")
    return button


def title_label(text: str) -> QLabel:
    label = QLabel(text)
    label.setObjectName("screenTitle")
    return label


__all__ = [
    "APP_STYLESHEET",
    "StatusBanner",
    "horizontal_bar",
    "make_danger",
    "make_primary",
    "scrollable",
    "title_label",
]
