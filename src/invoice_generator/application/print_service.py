"""Print service: send a rendered invoice PDF to the OS printer (Task 49).

Renders the invoice through :class:`PdfService` (the single rendering path,
Req 20.1) to a temporary PDF, then prints it via a platform-replaceable
:class:`PrintPort`. The default adapter uses the Windows shell "print" verb
proven by the printing spike (Task 30); the port keeps platform-specific code
out of the business layer (design section 24). The port is injectable so tests
never spool a real job.

References: requirements Req 20.3; design section 24; OPEN_QUESTIONS Q-015.
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol, runtime_checkable

from invoice_generator.application.pdf_service import PdfService
from invoice_generator.domain.models import Invoice


@runtime_checkable
class PrintPort(Protocol):
    """Sends a file at ``path`` to the OS print pipeline."""

    def print_file(self, path: str) -> None: ...


class ShellPrintAdapter:
    """Windows print adapter delegating to the printing infrastructure adapter."""

    def print_file(self, path: str) -> None:
        from invoice_generator.infrastructure.printing.windows_print_adapter import print_default

        print_default(path)


class PrintService:
    def __init__(self, pdf_service: PdfService, print_port: PrintPort | None = None) -> None:
        self._pdf = pdf_service
        self._port: PrintPort = print_port if print_port is not None else ShellPrintAdapter()

    def print_invoice(self, invoice: Invoice, spool_dir: Path) -> Path:
        """Render the invoice to a PDF in ``spool_dir`` and send it to print.

        Returns the path of the spooled PDF. Rendering uses the same path as
        preview/export (Req 20.1); printing is delegated to the port.
        """
        number = invoice.invoice_number or str(invoice.id)
        spool_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = spool_dir / f"print_{_safe(number)}_{uuid.uuid4().hex}.pdf"
        self._pdf.export(invoice, pdf_path)
        self._port.print_file(str(pdf_path))
        return pdf_path


def _safe(text: str) -> str:
    return text.replace("/", "_").replace("\\", "_")


__all__ = ["PrintPort", "PrintService", "ShellPrintAdapter"]
