"""Tests for the Windows preview/open spike (Task 29).

The actual GUI launch cannot be asserted in CI, so these tests exercise the
open code path with an injected opener (no window is shown). The real
default-viewer launch is a manual/documented step (see OPEN_QUESTIONS Q-015).
"""

from __future__ import annotations

from pathlib import Path

import pytest
from spikes.pdf_poc import SampleInvoiceDTO, render_sample_pdf
from spikes.windows_preview import open_pdf


def test_open_pdf_invokes_opener_with_path(tmp_path: Path) -> None:
    pdf = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    opened: list[str] = []
    open_pdf(pdf, opener=opened.append)
    assert opened == [str(pdf)]


def test_open_pdf_missing_file_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        open_pdf(tmp_path / "does_not_exist.pdf", opener=lambda _p: None)
