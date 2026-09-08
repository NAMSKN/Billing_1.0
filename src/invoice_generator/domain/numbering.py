"""Invoice numbering configuration, financial-year derivation, and formatting.

Produces human-readable invoice numbers of the form ``PREFIX/FY/NNN`` (e.g.
``SE/26-27/043``). This module holds only the *configuration and formatting*;
safe transactional sequence allocation is a separate concern (Task 20,
``application/numbering_service.py``).

Unresolved product choices use the documented safe interims:
- number display format ``PREFIX/FY/NNN`` (OPEN_QUESTIONS Q-002);
- default sequence start 1 and pad width 3 (Q-003);
- Indian financial year, 1 April - 31 March, rendered ``YY-YY`` (Q-004).

All configuration is data-driven so these choices remain changeable without
code edits. This module is pure: no I/O, no clock, no global state (the caller
supplies dates).

References: requirements Req 10.1, 10.3, 10.7; design section 9;
OPEN_QUESTIONS Q-002, Q-003, Q-004.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

INDIAN_FY_START_MONTH = 4  # April


@dataclass(frozen=True)
class NumberingConfig:
    """Configurable invoice-numbering parameters.

    ``prefix`` and ``fy_scheme`` shape the number; ``pad_width`` and
    ``start_value`` control the sequence portion. Defaults follow the safe
    interims (Q-002/Q-003/Q-004).
    """

    prefix: str = "SE"
    pad_width: int = 3
    start_value: int = 1
    fy_scheme: str = "IN"


@dataclass(frozen=True)
class FinancialYear:
    """A financial year as an inclusive (start_year, end_year) pair."""

    start_year: int
    end_year: int


def financial_year_for(when: date, scheme: str = "IN") -> FinancialYear:
    """Return the financial year containing ``when``.

    For the Indian scheme (``"IN"``), the year runs 1 April - 31 March: a date
    in April..December belongs to (year, year+1); January..March belongs to
    (year-1, year). Other schemes are not supported in V1.
    """
    if scheme != "IN":
        raise ValueError(f"unsupported financial-year scheme: {scheme!r}")
    if when.month >= INDIAN_FY_START_MONTH:
        return FinancialYear(when.year, when.year + 1)
    return FinancialYear(when.year - 1, when.year)


def format_financial_year(fy: FinancialYear) -> str:
    """Render a financial year as ``YY-YY`` (e.g. ``26-27``)."""
    return f"{fy.start_year % 100:02d}-{fy.end_year % 100:02d}"


def format_invoice_number(config: NumberingConfig, fy_label: str, sequence: int) -> str:
    """Build the invoice number ``PREFIX/FY/NNN`` from its parts.

    The sequence is zero-padded to ``config.pad_width`` (widening naturally for
    values that exceed the pad width).
    """
    padded = f"{sequence:0{config.pad_width}d}"
    return f"{config.prefix}/{fy_label}/{padded}"


def build_invoice_number(config: NumberingConfig, when: date, sequence: int) -> str:
    """Convenience: derive the FY from ``when`` and format the full number."""
    fy = financial_year_for(when, config.fy_scheme)
    return format_invoice_number(config, format_financial_year(fy), sequence)
