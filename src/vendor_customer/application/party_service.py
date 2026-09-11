"""Application service for the Customer / Vendor (Party) master.

Orchestrates create/update/archive/list/search with offline, format-only
validation. There is NO GSTIN auto-fill: PAN and state code are taken exactly
as entered and never derived from a GSTIN (product rules, sections 2/8).

Timestamps use an injected :class:`Clock` and ids an injected
:class:`IdGenerator` for deterministic tests. When a
:class:`CustomerProjection` is supplied, customer-capable parties are mirrored
into the invoice-facing customer table so invoice integration keeps working.
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Protocol, runtime_checkable

from common.domain.ids import IdGenerator, Uuid4Generator
from vendor_customer.application.dto import (
    CreatePartyCommand,
    PartyInput,
    UpdatePartyCommand,
)
from vendor_customer.application.errors import DuplicatePartyError, PartyValidationError
from vendor_customer.application.ports import CustomerProjection
from vendor_customer.domain.models import Party, PartyType
from vendor_customer.domain.repositories import PartyRepository
from vendor_customer.domain.rules import validate_party


@runtime_checkable
class SupportsNow(Protocol):
    """Minimal clock: returns the current timezone-aware instant.

    Kept narrow so any project clock (the invoice module's ``Clock`` or the
    ``common`` clock) satisfies it. Time is injected for deterministic tests.
    """

    def now(self) -> datetime: ...


class _SystemClock:
    def now(self) -> datetime:
        return datetime.now(UTC)


class PartyService:
    """Use-case entry point for managing trading parties."""

    def __init__(
        self,
        repository: PartyRepository,
        *,
        id_generator: IdGenerator | None = None,
        clock: SupportsNow | None = None,
        customer_projection: CustomerProjection | None = None,
    ) -> None:
        self._repo = repository
        self._id_gen: IdGenerator = id_generator or Uuid4Generator()
        self._clock: SupportsNow = clock or _SystemClock()
        self._projection = customer_projection

    # --- create / update ---

    def create_party(self, cmd: CreatePartyCommand) -> Party:
        """Validate and persist a new party. Raises on validation/duplicate."""
        now = self._clock.now().isoformat()
        party = self._assemble(
            party_id=self._id_gen(),
            data=cmd.data,
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        self._reject_if_invalid(party)
        self._reject_if_duplicate(party)
        self._persist(party)
        return party

    def update_party(self, cmd: UpdatePartyCommand) -> Party:
        """Validate and persist changes to an existing party."""
        existing = self._repo.get(cmd.id)
        created_at = existing.created_at if existing is not None else ""
        party = self._assemble(
            party_id=cmd.id,
            data=cmd.data,
            is_active=cmd.is_active,
            created_at=created_at,
            updated_at=self._clock.now().isoformat(),
        )
        self._reject_if_invalid(party)
        self._persist(party)
        return party

    # --- queries ---

    def get_party(self, party_id: uuid.UUID) -> Party | None:
        return self._repo.get(party_id)

    def list_parties(
        self,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        return self._repo.list_all(party_type=party_type, include_archived=include_archived)

    def search_parties(
        self,
        term: str,
        *,
        party_type: PartyType | None = None,
        include_archived: bool = False,
    ) -> Sequence[Party]:
        """Filter parties by company name, contact person, phone, or GSTIN."""
        parties = self._repo.list_all(
            party_type=party_type, include_archived=include_archived
        )
        needle = term.strip().lower()
        if not needle:
            return parties
        return [p for p in parties if _matches(p, needle)]

    def archive_party(self, party_id: uuid.UUID) -> bool:
        """Soft-delete a party and deactivate its customer projection."""
        changed = self._repo.archive(party_id)
        if changed and self._projection is not None:
            self._projection.deactivate(party_id)
        return changed

    # --- duplicate detection (product rules, section 18) ---

    def find_duplicate(self, data: PartyInput) -> Party | None:
        """Return an existing party that matches by GSTIN, else name+phone."""
        gstin = data.gstin.strip().upper()
        if gstin:
            match = self._repo.get_by_gstin(gstin)
            if match is not None:
                return match
        if data.company_name.strip() and data.contact_no.strip():
            return self._repo.find_by_name_and_phone(data.company_name, data.contact_no)
        return None

    # --- internals ---

    def _assemble(
        self,
        *,
        party_id: uuid.UUID,
        data: PartyInput,
        is_active: bool,
        created_at: str,
        updated_at: str,
    ) -> Party:
        return Party(
            id=party_id,
            company_type=data.company_type,
            company_name=data.company_name.strip(),
            contact_person=data.contact_person.strip(),
            contact_no=data.contact_no.strip(),
            email=data.email.strip(),
            registration_type=data.registration_type,
            gstin=data.gstin.strip().upper(),
            pan=data.pan.strip().upper(),
            billing_address=data.billing_address,
            shipping_address=data.shipping_address,
            distance_for_eway_bill_km=data.distance_for_eway_bill_km,
            group_id=data.group_id,
            bank_name=data.bank_name.strip(),
            bank_ifsc_code=data.bank_ifsc_code.strip().upper(),
            bank_account_number=data.bank_account_number.strip(),
            fax_no=data.fax_no.strip(),
            website=data.website.strip(),
            credit_limit=data.credit_limit,
            due_days=data.due_days,
            note=data.note.strip(),
            visible_on_documents=data.visible_on_documents,
            custom_field_1=data.custom_field_1.strip(),
            custom_field_2=data.custom_field_2.strip(),
            custom_field_3=data.custom_field_3.strip(),
            customer_balance=data.customer_balance,
            vendor_balance=data.vendor_balance,
            is_active=is_active,
            created_at=created_at,
            updated_at=updated_at,
        )

    def _reject_if_invalid(self, party: Party) -> None:
        errors = validate_party(party)
        if errors:
            raise PartyValidationError(errors)

    def _reject_if_duplicate(self, party: Party) -> None:
        if party.gstin:
            existing = self._repo.get_by_gstin(party.gstin)
            if existing is not None and existing.id != party.id:
                raise DuplicatePartyError(
                    f"A party with GSTIN '{party.gstin}' already exists.",
                    existing_id=existing.id,
                )

    def _persist(self, party: Party) -> None:
        self._repo.save(party)
        if self._projection is not None and party.company_type.is_customer:
            self._projection.sync_from_party(party)


def _matches(party: Party, needle: str) -> bool:
    return any(
        needle in field.lower()
        for field in (
            party.company_name,
            party.contact_person,
            party.contact_no,
            party.gstin,
        )
    )
