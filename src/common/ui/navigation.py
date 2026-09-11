"""Cross-screen navigation port (UI remediation).

Screens must be able to ask the shell to switch screens and to open a specific
invoice in the editor, without knowing about each other (keeping the widgets
thin and decoupled — DECISIONS D-021). :class:`MainWindow` implements this
protocol; screens receive it as a constructor dependency and call it.
"""

from __future__ import annotations

import uuid
from typing import Protocol, runtime_checkable


@runtime_checkable
class Navigator(Protocol):
    """Navigation actions the shell offers to screens."""

    def go_to(self, screen_name: str) -> None:
        """Switch the active screen by name."""
        ...

    def open_invoice(self, invoice_id: uuid.UUID) -> None:
        """Open an existing invoice (draft or finalized) in the editor."""
        ...


__all__ = ["Navigator"]
