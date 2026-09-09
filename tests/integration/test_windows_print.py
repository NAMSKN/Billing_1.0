"""Tests for the Windows printing spike (Task 30).

A real print job is not spooled in CI (it would need a physical printer / open
an app dialog), so the print code path is exercised with an injected action.
The real print is a manual/documented step (see OPEN_QUESTIONS Q-015).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from spikes.pdf_poc import SampleInvoiceDTO, render_sample_pdf
from spikes.windows_print import list_printers, print_pdf


def test_print_pdf_invokes_action_with_path(tmp_path: Path) -> None:
    pdf = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    sent: list[str] = []
    print_pdf(pdf, action=sent.append)
    assert sent == [str(pdf)]


def test_print_pdf_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        print_pdf(tmp_path / "missing.pdf", action=lambda _p: None)


def test_list_printers_returns_list() -> None:
    # Read-only environment probe; tolerant of having no printers.
    printers = list_printers()
    assert isinstance(printers, list)
    assert all(isinstance(name, str) for name in printers)
