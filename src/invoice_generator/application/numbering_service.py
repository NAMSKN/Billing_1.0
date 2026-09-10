"""Invoice-number allocation service.

Allocates the next sequence value for a numbering scope and formats the
invoice number. It **participates in the caller's transaction** (DECISIONS
D-026): the finalization use case opens the transaction with ``BEGIN
IMMEDIATE`` (a SQLite reserved write lock, D-028 — never ``SELECT ... FOR
UPDATE``) and calls :meth:`NumberingService.allocate` within it. The allocator
reads and updates the sequence row via the repository but never begins or
commits its own transaction.

Issuance semantics (DECISIONS D-027): the returned number is only *issued* when
the outer transaction commits. If that transaction rolls back, the sequence
advance is undone and the number may be allocated again later — so a failed
finalization never permanently consumes a number.

The sequence is never derived from ``MAX(invoice_number)`` (DECISIONS D-012); a
dedicated per-scope sequence with a monotonic ``high_water_mark`` is used, the
latter underpinning restore reconciliation (D-029).

Contention handling (SQLite ``BUSY``) is intentionally left to the caller/use
case per the task scope; this method performs a single read/update.

References: requirements Req 10; DECISIONS D-012, D-026, D-027, D-028;
design section 9; OPEN_QUESTIONS Q-012.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date

from invoice_generator.application.errors import NumberingError
from invoice_generator.domain.models import SequenceState
from invoice_generator.domain.numbering import (
    NumberingConfig,
    financial_year_for,
    format_financial_year,
    format_invoice_number,
)
from invoice_generator.domain.repositories import SequenceRepository


@dataclass(frozen=True)
class Allocation:
    """The result of allocating a number within the current transaction."""

    invoice_number: str
    sequence: int
    financial_year_label: str


class NumberingService:
    def __init__(self, sequence_repository: SequenceRepository) -> None:
        self._sequences = sequence_repository

    def allocate(
        self,
        company_id: uuid.UUID,
        invoice_date: date,
        config: NumberingConfig,
    ) -> Allocation:
        """Allocate the next sequence for the scope implied by ``invoice_date``.

        Must be called inside the caller's ``BEGIN IMMEDIATE`` transaction. The
        financial year is derived from ``invoice_date`` (so a backdated invoice
        allocates from that year's sequence, OPEN_QUESTIONS Q-012). The
        allocator increments ``next_sequence`` and advances ``high_water_mark``,
        persisting the updated state without committing.
        """
        fy = financial_year_for(invoice_date, config.fy_scheme)
        fy_label = format_financial_year(fy)

        state = self._sequences.get(company_id, fy_label, config.prefix)
        if state is None:
            sequence = config.start_value
            high_water = 0
        else:
            sequence = state.next_sequence
            high_water = state.high_water_mark

        if sequence < config.start_value:
            raise NumberingError(
                f"sequence {sequence} is below the configured start value {config.start_value}"
            )

        updated = SequenceState(
            company_id=company_id,
            financial_year=fy_label,
            prefix=config.prefix,
            next_sequence=sequence + 1,
            high_water_mark=max(high_water, sequence),
        )
        self._sequences.save(updated)

        number = format_invoice_number(config, fy_label, sequence)
        return Allocation(invoice_number=number, sequence=sequence, financial_year_label=fy_label)
