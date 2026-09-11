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
from typing import Protocol

from invoice_generator.application.errors import NumberingError, ReconciliationPendingError
from invoice_generator.domain.models import SequenceState
from invoice_generator.domain.numbering import (
    NumberingConfig,
    financial_year_for,
    format_financial_year,
    format_invoice_number,
)
from invoice_generator.domain.repositories import SequenceRepository


class ReconciliationGate(Protocol):
    """Port that reports whether post-restore numbering reconciliation is pending.

    After a restore, new invoice numbers must not be issued until the operator
    confirms reconciliation (DECISIONS D-029; OPEN_QUESTIONS Q-009). The
    concrete implementation lives in infrastructure (backed by reconciliation
    metadata preserved outside the database file); the numbering service depends
    only on this port.
    """

    def is_reconciliation_pending(self) -> bool: ...


class _AlwaysAllowGate:
    """Default gate: reconciliation is never pending (normal operation)."""

    def is_reconciliation_pending(self) -> bool:
        return False


@dataclass(frozen=True)
class Allocation:
    """The result of allocating a number within the current transaction."""

    invoice_number: str
    sequence: int
    financial_year_label: str


class NumberingService:
    def __init__(
        self,
        sequence_repository: SequenceRepository,
        *,
        reconciliation_gate: ReconciliationGate | None = None,
    ) -> None:
        self._sequences = sequence_repository
        self._gate: ReconciliationGate = (
            reconciliation_gate if reconciliation_gate is not None else _AlwaysAllowGate()
        )

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

        Issuance is blocked while post-restore reconciliation is pending
        (DECISIONS D-029): a :class:`ReconciliationPendingError` is raised so no
        number is reused before the operator confirms reconciliation.
        """
        if self._gate.is_reconciliation_pending():
            raise ReconciliationPendingError(
                "numbering reconciliation pending after restore; issuance blocked"
            )

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

    def reconcile_scope(
        self,
        company_id: uuid.UUID,
        financial_year_label: str,
        prefix: str,
        trusted_high_water_mark: int,
    ) -> SequenceState:
        """Advance one numbering scope past the trusted pre-restore high-water.

        After a restore, the restored (older) database's sequence may lag behind
        numbers already issued in the real world. Reconciliation advances the
        effective sequence so the next number is at least
        ``trusted_high_water_mark + 1`` and the high-water mark is at least the
        trusted value — using the captured pre-restore state, NOT the restored
        backup's internal mark (DECISIONS D-029). The advance is monotonic: an
        already-ahead scope is never rolled back.

        Must be called inside the caller's transaction (DECISIONS D-026); it
        reads and writes the sequence row without committing.
        """
        state = self._sequences.get(company_id, financial_year_label, prefix)
        current_next = state.next_sequence if state is not None else 0
        current_high_water = state.high_water_mark if state is not None else 0

        target_next = max(current_next, trusted_high_water_mark + 1)
        target_high_water = max(current_high_water, trusted_high_water_mark)

        reconciled = SequenceState(
            company_id=company_id,
            financial_year=financial_year_label,
            prefix=prefix,
            next_sequence=target_next,
            high_water_mark=target_high_water,
        )
        self._sequences.save(reconciled)
        return reconciled


__all__ = ["Allocation", "NumberingService", "ReconciliationGate"]
