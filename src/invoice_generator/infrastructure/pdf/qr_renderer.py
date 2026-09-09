"""UPI QR-code image generation for the invoice PDF.

Generates a QR code PNG from UPI payment data and returns a sized ReportLab
``Image``. Used by the payment component; the QR is only produced when UPI data
is configured (Req 19.5), so no blank placeholder is ever drawn.

References: requirements Req 19.5, 20; design section 20.
"""

from __future__ import annotations

import io

import qrcode
from reportlab.lib.units import mm
from reportlab.platypus import Image

_QR_SIZE = 28 * mm


def upi_qr_payload(upi_id: str) -> str:
    """Build a minimal UPI intent payload for ``upi_id`` (e.g. name@bank)."""
    return f"upi://pay?pa={upi_id}"


def make_qr_image(data: str, size: float = _QR_SIZE) -> Image:
    """Return a square ReportLab ``Image`` of a QR code encoding ``data``."""
    qr = qrcode.make(data)
    buffer = io.BytesIO()
    qr.save(buffer, format="PNG")
    buffer.seek(0)
    image = Image(buffer, width=size, height=size)
    return image


__all__ = ["make_qr_image", "upi_qr_payload"]
