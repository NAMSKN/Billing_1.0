"""Windows preview/open spike (Task 29).

Proves that a generated PDF can be opened/previewed with the Windows default
PDF viewer, and documents the chosen approach (Req 26; OPEN_QUESTIONS Q-015).

Chosen approach: use ``os.startfile(path)`` on Windows, which launches the file
with its user-associated application (the default PDF viewer). This is the
simplest reliable "open/preview" path and requires no extra dependency. The
opener is injectable so the code path can be exercised in tests without
actually launching a GUI (which cannot be asserted in CI).

Run directly on Windows to open a sample invoice in the default viewer::

    python -m spikes.windows_preview
"""

from __future__ import annotations

import os
import sys
from collections.abc import Callable
from pathlib import Path

from spikes.pdf_poc import SampleInvoiceDTO, default_output_path, render_sample_pdf

# An opener takes a filesystem path string and launches the associated viewer.
Opener = Callable[[str], None]


def _default_opener(path: str) -> None:
    """Open ``path`` with the OS default application.

    On Windows this uses ``os.startfile`` (the standard way to open a file with
    its associated program). On other platforms it raises, since this spike is
    Windows-first (Req 26); a cross-platform adapter is a later concern.
    """
    startfile = getattr(os, "startfile", None)
    if startfile is None:
        raise RuntimeError(
            "os.startfile is unavailable; this preview spike targets Windows (Req 26)"
        )
    startfile(path)


def open_pdf(path: Path, opener: Opener | None = None) -> None:
    """Open ``path`` in the default viewer via ``opener`` (default: OS default).

    Raises:
        FileNotFoundError: if ``path`` does not exist.
    """
    if not path.exists():
        raise FileNotFoundError(f"PDF to preview does not exist: {path}")
    (opener if opener is not None else _default_opener)(str(path))


def main() -> int:
    path = render_sample_pdf(SampleInvoiceDTO(), default_output_path())
    print(f"opening {path} in the default viewer...")
    try:
        open_pdf(path)
    except RuntimeError as exc:
        print(f"could not open: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
