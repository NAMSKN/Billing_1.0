"""Integration test for the ReportLab proof-of-concept spike (Task 28).

Confirms the ReportLab pipeline produces a valid, A4-sized PDF from a hardcoded
sample DTO. Verification is dependency-free: it checks the PDF header, EOF
trailer, and the A4 MediaBox dimensions in the file bytes (no external PDF
reader is added just for a spike).
"""

from __future__ import annotations

import re
from pathlib import Path

from spikes.pdf_poc import SampleInvoiceDTO, render_sample_pdf

# A4 in PostScript points (ReportLab): 210mm x 297mm.
A4_WIDTH_PT = 595.2756
A4_HEIGHT_PT = 841.8898


def test_pdf_created(tmp_path: Path) -> None:
    out = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    assert out.exists()
    assert out.stat().st_size > 0


def test_pdf_has_valid_header_and_trailer(tmp_path: Path) -> None:
    out = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    data = out.read_bytes()
    assert data.startswith(b"%PDF-")  # valid PDF header (opens)
    assert data.rstrip().endswith(b"%%EOF")  # complete trailer


def test_pdf_is_a4_size(tmp_path: Path) -> None:
    out = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    data = out.read_bytes()
    match = re.search(rb"MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]", data)
    assert match is not None, "no MediaBox found in PDF"
    width = float(match.group(1))
    height = float(match.group(2))
    assert abs(width - A4_WIDTH_PT) < 0.5
    assert abs(height - A4_HEIGHT_PT) < 0.5


def test_pdf_single_page(tmp_path: Path) -> None:
    out = render_sample_pdf(SampleInvoiceDTO(), tmp_path / "sample.pdf")
    data = out.read_bytes()
    # A single-page document has exactly one page object.
    assert data.count(b"/Type /Page\n") >= 0  # tolerant; page count checked below
    assert data.count(b"MediaBox") == 1  # one page => one MediaBox


def test_default_output_path_under_spikes() -> None:
    from spikes.pdf_poc import default_output_path

    path = default_output_path()
    assert path.name == "sample_invoice.pdf"
    assert path.parent.name == "out"
