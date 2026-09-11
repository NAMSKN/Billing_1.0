"""Windows preview/print adapter (production home of the Task 29/30 spikes).

``open_default`` opens a file in the OS default viewer (preview) and
``print_default`` sends it to the default printer via the shell "print" verb —
both via ``os.startfile`` on Windows (design section 24; OPEN_QUESTIONS Q-015).
Keeping this behind a thin adapter isolates platform-specific code from the UI
and application layers.
"""

from __future__ import annotations

import os


def open_default(path: str) -> None:
    """Open ``path`` in the OS default application (preview)."""
    startfile = getattr(os, "startfile", None)
    if startfile is None:
        raise RuntimeError("os.startfile is unavailable; preview targets Windows (Req 26)")
    startfile(path)


def print_default(path: str) -> None:
    """Send ``path`` to the default printer via the shell 'print' verb."""
    startfile = getattr(os, "startfile", None)
    if startfile is None:
        raise RuntimeError("os.startfile is unavailable; printing targets Windows (Req 26)")
    startfile(path, "print")


__all__ = ["open_default", "print_default"]
