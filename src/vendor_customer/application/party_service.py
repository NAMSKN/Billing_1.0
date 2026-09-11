"""Application service for Vendor & Customer management."""

from __future__ import annotations

import uuid
from typing import Optional, Sequence

from common.domain.ids import IdGenerator, Uuid4Generator
from vendor_customer.application.dto import CreatePartyCommand, UpdatePartyCommand
from vendor_customer.domain.models import Party, PartyRole
from vendor_customer.domain.repositories import PartyRepository
from vendor_customer.domain.rules import (
    extract_pan,
    extract_state_code,
    validate_party,
)


class PartyService:
    """Orchestrates party master creation, updates, validation, and retrieval."""

    def __init__(
        self,
        repository: PartyRepository,
        id_generator: IdGenerator | None = None,
    ) -> None:
        self._repo = repository
        self._id_gen = id_generator or Uuid4Generator()

    def create_party(self, cmd: CreatePartyCommand) -> Party:
        """Create and persist a new customer or vendor party."""
        clean_gstin = cmd.gstin.strip().upper()
        pan = cmd.pan.strip().upper() or extract_pan(clean_gstin)

        billing_addr = cmd.billing_address
        if clean_gstin and not billing_addr.state_code:
            billing_addr = billing_addr.model_copy(
                update={"state_code": extract_state_code(clean_gstin)}
            )

        party = Party(
            id=self._id_gen(),
            display_name=cmd.display_name.strip(),
            legal_name=cmd.legal_name.strip(),
            role=cmd.role,
            gstin=clean_gstin,
            pan=pan,
            contact_person=cmd.contact_person.strip(),
            phone=cmd.phone.strip(),
            email=cmd.email.strip(),
            billing_address=billing_addr,
            shipping_address=cmd.shipping_address,
            bank_details=cmd.bank_details,
            credit_days=cmd.credit_days,
            is_active=True,
        )

        errors = validate_party(party)
        if errors:
            raise ValueError("; ".join(errors))

        if clean_gstin:
            existing = self._repo.get_by_gstin(clean_gstin)
            if existing and existing.id != party.id:
                raise ValueError(f"An active party with GSTIN '{clean_gstin}' already exists.")

        self._repo.save(party)
        return party

    def update_party(self, cmd: UpdatePartyCommand) -> Party:
        """Update an existing party profile."""
        clean_gstin = cmd.gstin.strip().upper()
        pan = cmd.pan.strip().upper() or extract_pan(clean_gstin)

        party = Party(
            id=cmd.id,
            display_name=cmd.display_name.strip(),
            legal_name=cmd.legal_name.strip(),
            role=cmd.role,
            gstin=clean_gstin,
            pan=pan,
            contact_person=cmd.contact_person.strip(),
            phone=cmd.phone.strip(),
            email=cmd.email.strip(),
            billing_address=cmd.billing_address,
            shipping_address=cmd.shipping_address,
            bank_details=cmd.bank_details,
            credit_days=cmd.credit_days,
            is_active=cmd.is_active,
        )

        errors = validate_party(party)
        if errors:
            raise ValueError("; ".join(errors))

        self._repo.save(party)
        return party

    def get_party(self, party_id: uuid.UUID) -> Optional[Party]:
        """Retrieve party by UUID."""
        return self._repo.get_by_id(party_id)

    def list_parties(
        self, role: Optional[PartyRole] = None, include_inactive: bool = False
    ) -> Sequence[Party]:
        """List parties matching role filter."""
        return self._repo.list_all(role=role, include_inactive=include_inactive)

    def archive_party(self, party_id: uuid.UUID) -> bool:
        """Soft-delete party so it cannot be used on new documents."""
        return self._repo.archive(party_id)
