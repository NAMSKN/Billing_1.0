"""Windows printing spike (Task 30).

Proves the OS print path for a generated PDF and does a basic printer
compatibility check, documenting the chosen approach (Req 26; finding 3.14;
OPEN_QUESTIONS Q-015).

Chosen approach: print via the Windows shell "print" verb using
``os.startfile(path, "print")``, which sends the PDF to the user's default
printer through its associated application. This is dependency-free and mirrors
the preview spike (Task 29). The print action is injectable so the code path is
testable without spooling a real job.

Compatibility check: :func:`list_printers` enumerates installed printers via
PowerShell (read-only, no Python dependency added) so the environment can be
documented.

Run directly on Windows to attempt a real print to the default printer::

    python -m spikes.windows_print

Note: a real ``print`` verb sends to the *default* printer and may open the
associated app's dialog (e.g. "Microsoft Print to PDF" prompts for a filename).
The spike does not force a physical print in automated runs to avoid wasting
paper / interactive prompts.
"""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from spikes.pdf_poc import SampleInvoiceDTO, default_output_path, render_sample_pdf

# A print action takes a path string and sends it to the print pipeline.
PrintAction = Callable[[str], None]


def _default_print_action(path: str) -> None:
    """Send ``path`` to the default printer via the Windows shell 'print' verb."""
    startfile = getattr(os, "startfile", None)
    if startfile is None:
        raise RuntimeError(
            "os.startfile is unavailable; this printing spike targets Windows (Req 26)"
        )
    startfile(path, "print")


def print_pdf(path: Path, action: PrintAction | None = None) -> None:
    """Print ``path`` via ``action`` (default: Windows shell 'print' verb).

    Raises:
        FileNotFoundError: if ``path`` does not exist.
    """
    if not path.exists():
        raise FileNotFoundError(f"PDF to print does not exist: {path}")
    (action if action is not None else _default_print_action)(str(path))


def list_printers() -> list[str]:
    """Return installed printer names (best-effort, read-only).

    Uses PowerShell's ``Win32_Printer`` query. Returns an empty list if the
    query is unavailable so callers can treat "no printers" as a documented
    limitation rather than an error.
    """
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if completed.returncode != 0:
        return []
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()]


def main() -> int:
    printers = list_printers()
    if printers:
        print("installed printers:")
        for name in printers:
            print(f"  - {name}")
    else:
        print("no printers detected (documented limitation)")

    path = render_sample_pdf(SampleInvoiceDTO(), default_output_path())
    print(f"sending {path} to the default printer via the shell 'print' verb...")
    try:
        print_pdf(path)
    except RuntimeError as exc:
        print(f"could not print: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
