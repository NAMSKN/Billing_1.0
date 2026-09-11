"""Shared postal and GST state address model."""

from __future__ import annotations

from common.domain.base import DomainModel


class Address(DomainModel):
    """A postal address plus its GST state identity.

    Used across party master, buyer/consignee in invoices, and vendor plant addresses.
    """

    line: str = ""
    line2: str = ""
    city: str = ""
    state: str = ""
    state_code: str = ""
    pincode: str = ""
