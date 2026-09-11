"""Centralized light theme (UI remediation phase 2).

One intentional light theme for the whole application, using only white, black,
red, yellow, and neutral light gray. The theme is enforced two ways so a user's
Windows dark mode cannot leak through:

1. A forced light ``QPalette`` on the Fusion style (native platform palettes,
   which follow the OS theme, are not used).
2. The shared application stylesheet from :mod:`ui_kit`.

Call :func:`force_light_theme` once on the ``QApplication`` at startup.
"""

from __future__ import annotations

from PySide6.QtGui import QColor, QPalette
from PySide6.QtWidgets import QApplication

from invoice_generator.ui.common.ui_kit import APP_STYLESHEET

# Semantic palette. Accents (red/yellow) are used sparingly in the stylesheet.
WHITE = "#ffffff"
BLACK = "#1a1a1a"
RED = "#c62828"
YELLOW = "#f6c445"
LIGHT_GRAY = "#e6e6e6"
MID_GRAY = "#f4f4f4"


def force_light_theme(app: QApplication) -> None:
    """Apply the forced light palette + stylesheet to ``app``.

    Uses the Fusion style (consistent across platforms) and an explicit light
    palette so Windows dark mode cannot render controls dark. Idempotent.
    """
    app.setStyle("Fusion")
    app.setPalette(_light_palette())
    app.setStyleSheet(APP_STYLESHEET)


def _light_palette() -> QPalette:
    p = QPalette()
    white = QColor(WHITE)
    black = QColor(BLACK)
    gray = QColor(LIGHT_GRAY)
    disabled_text = QColor("#9a9a9a")

    p.setColor(QPalette.ColorRole.Window, white)
    p.setColor(QPalette.ColorRole.WindowText, black)
    p.setColor(QPalette.ColorRole.Base, white)
    p.setColor(QPalette.ColorRole.AlternateBase, QColor(MID_GRAY))
    p.setColor(QPalette.ColorRole.Text, black)
    p.setColor(QPalette.ColorRole.Button, QColor(MID_GRAY))
    p.setColor(QPalette.ColorRole.ButtonText, black)
    p.setColor(QPalette.ColorRole.ToolTipBase, white)
    p.setColor(QPalette.ColorRole.ToolTipText, black)
    p.setColor(QPalette.ColorRole.PlaceholderText, QColor("#8a8a8a"))
    p.setColor(QPalette.ColorRole.Highlight, QColor(RED))
    p.setColor(QPalette.ColorRole.HighlightedText, white)
    p.setColor(QPalette.ColorRole.Link, QColor(RED))

    # Disabled states remain readable on a light surface.
    for group in (QPalette.ColorGroup.Disabled,):
        p.setColor(group, QPalette.ColorRole.WindowText, disabled_text)
        p.setColor(group, QPalette.ColorRole.Text, disabled_text)
        p.setColor(group, QPalette.ColorRole.ButtonText, disabled_text)
        p.setColor(group, QPalette.ColorRole.Base, white)
        p.setColor(group, QPalette.ColorRole.Button, gray)
    return p


def is_light_palette(app: QApplication) -> bool:
    """True if the app palette is light (light backgrounds, dark text)."""
    palette = app.palette()
    window = palette.color(QPalette.ColorRole.Window)
    text = palette.color(QPalette.ColorRole.WindowText)
    return window.lightness() > 180 and text.lightness() < 100


__all__ = [
    "BLACK",
    "LIGHT_GRAY",
    "RED",
    "WHITE",
    "YELLOW",
    "force_light_theme",
    "is_light_palette",
]
