"""Golden invoice regression fixtures (invoices 043 and 089).

These are **aggregate** fixtures (Req 28, OPEN_QUESTIONS Q-013). The two real
source invoices document their aggregate taxable value, CGST, SGST, round-off,
and grand total, but the exact per-line quantities/rates behind those
aggregates are not available in this repository. Per Q-013 we do **not**
fabricate line-level values: each fixture models the invoice as a single
aggregate taxable amount at the standard 18% intra-state configuration, which
is sufficient to lock in the tax/round-off/grand-total behavior of the
calculation engine.

If the source invoice PDFs become available, complete line-level fixtures can
be added and labeled as such; until then only the aggregate fixtures below are
authoritative.

References: requirements Req 28; DECISIONS D-030; OPEN_QUESTIONS Q-013.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from invoice_generator.domain.models import TaxRateConfig

#: Whether complete per-line source data is available (see Q-013). Aggregate
#: fixtures do not require it; this flag documents the current state.
LINE_LEVEL_SOURCE_AVAILABLE = False

#: Standard 18% intra-state configuration used by the source invoices.
STANDARD_18 = TaxRateConfig(
    total_rate=Decimal("18"),
    cgst_rate=Decimal("9"),
    sgst_rate=Decimal("9"),
    igst_rate=Decimal("18"),
)


@dataclass(frozen=True)
class AggregateGoldenInvoice:
    """Documented aggregate values for a source invoice (intra-state, 18%)."""

    invoice_number: str
    customer: str
    taxable: Decimal
    cgst: Decimal
    sgst: Decimal
    round_off: Decimal
    grand_total: Decimal
    tax_config: TaxRateConfig = STANDARD_18


# Invoice 043 — DI-TECH MOULDS (Req 28.1).
GOLDEN_043 = AggregateGoldenInvoice(
    invoice_number="SE/26-27/043",
    customer="DI-TECH MOULDS",
    taxable=Decimal("12280.00"),
    cgst=Decimal("1105.20"),
    sgst=Decimal("1105.20"),
    round_off=Decimal("-0.40"),
    grand_total=Decimal("14490.00"),
)

# Invoice 089 — BMSS STEEL INDUSTRIES PRIVATE LIMITED (Req 28.2).
GOLDEN_089 = AggregateGoldenInvoice(
    invoice_number="SE/26-27/089",
    customer="BMSS STEEL INDUSTRIES PRIVATE LIMITED",
    taxable=Decimal("8332.00"),
    cgst=Decimal("749.88"),
    sgst=Decimal("749.88"),
    round_off=Decimal("0.24"),
    grand_total=Decimal("9832.00"),
)

ALL_GOLDEN = (GOLDEN_043, GOLDEN_089)
