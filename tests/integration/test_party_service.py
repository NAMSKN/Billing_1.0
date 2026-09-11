"""Integration tests for PartyService and PartyGroupService."""

from __future__ import annotations

from datetime import UTC
from decimal import Decimal

import pytest

from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from tests.support.id_factory import SequentialIdGenerator
from vendor_customer.application.dto import CreatePartyCommand, PartyInput, UpdatePartyCommand
from vendor_customer.application.errors import DuplicatePartyError, PartyValidationError
from vendor_customer.application.party_group_service import PartyGroupService
from vendor_customer.application.party_service import PartyService
from vendor_customer.domain.models import (
    BalanceType,
    OpeningBalance,
    PartyAddress,
    PartyType,
    RegistrationType,
)
from vendor_customer.infrastructure.db.sqlite_party_group_repository import (
    SqlitePartyGroupRepository,
)
from vendor_customer.infrastructure.db.sqlite_party_repository import SqlitePartyRepository


class _FrozenClock:
    def now(self):  # type: ignore[no-untyped-def]
        from datetime import datetime

        return datetime(2026, 9, 11, tzinfo=UTC)


@pytest.fixture()
def service() -> PartyService:
    conn = connect(":memory:")
    apply_pending(conn)
    return PartyService(
        SqlitePartyRepository(conn),
        id_generator=SequentialIdGenerator(1),
        clock=_FrozenClock(),
    )


def _india(**overrides: object) -> PartyInput:
    base = dict(
        company_name="ACME Traders",
        billing_address=PartyAddress(state="Maharashtra", state_code="27", city="Pune"),
    )
    base.update(overrides)
    return PartyInput(**base)  # type: ignore[arg-type]


def test_create_customer(service: PartyService) -> None:
    p = service.create_party(CreatePartyCommand(_india(company_type=PartyType.CUSTOMER)))
    assert p.company_type is PartyType.CUSTOMER
    assert p.created_at != ""


def test_create_vendor(service: PartyService) -> None:
    p = service.create_party(CreatePartyCommand(_india(company_type=PartyType.VENDOR)))
    assert p.company_type is PartyType.VENDOR


def test_create_customer_vendor_with_both_balances(service: PartyService) -> None:
    p = service.create_party(
        CreatePartyCommand(
            _india(
                company_type=PartyType.CUSTOMER_VENDOR,
                customer_balance=OpeningBalance(
                    balance_type=BalanceType.DEBIT, amount=Decimal("10.00")
                ),
                vendor_balance=OpeningBalance(
                    balance_type=BalanceType.CREDIT, amount=Decimal("20.00")
                ),
            )
        )
    )
    assert p.customer_balance.amount == Decimal("10.00")
    assert p.vendor_balance.balance_type is BalanceType.CREDIT


def test_no_gstin_auto_derivation(service: PartyService) -> None:
    # A valid GSTIN is entered but PAN/state_code are NOT auto-filled.
    p = service.create_party(
        CreatePartyCommand(
            _india(registration_type=RegistrationType.REGULAR, gstin="27ABCDE1234F1Z5")
        )
    )
    assert p.pan == ""  # not derived
    assert p.billing_address.state_code == "27"  # only what was entered


def test_missing_india_state_rejected(service: PartyService) -> None:
    with pytest.raises(PartyValidationError):
        service.create_party(
            CreatePartyCommand(_india(billing_address=PartyAddress(city="Pune")))
        )


def test_edit_party(service: PartyService) -> None:
    p = service.create_party(CreatePartyCommand(_india()))
    updated = service.update_party(
        UpdatePartyCommand(
            id=p.id, data=_india(company_name="ACME Renamed"), is_active=True
        )
    )
    assert updated.company_name == "ACME Renamed"
    assert len(service.list_parties()) == 1  # updated, not duplicated


def test_archive_party(service: PartyService) -> None:
    p = service.create_party(CreatePartyCommand(_india()))
    assert service.archive_party(p.id) is True
    assert service.list_parties() == []
    assert len(service.list_parties(include_archived=True)) == 1


def test_search_and_filter(service: PartyService) -> None:
    service.create_party(CreatePartyCommand(_india(company_name="Alpha Corp", contact_no="111")))
    service.create_party(
        CreatePartyCommand(_india(company_name="Beta Ltd", company_type=PartyType.VENDOR))
    )
    assert [p.company_name for p in service.search_parties("alpha")] == ["Alpha Corp"]
    assert [p.company_name for p in service.search_parties("111")] == ["Alpha Corp"]
    vendors = [p.company_name for p in service.list_parties(party_type=PartyType.VENDOR)]
    assert vendors == ["Beta Ltd"]


def test_duplicate_gstin_rejected(service: PartyService) -> None:
    service.create_party(
        CreatePartyCommand(
            _india(registration_type=RegistrationType.REGULAR, gstin="27ABCDE1234F1Z5")
        )
    )
    with pytest.raises(DuplicatePartyError):
        service.create_party(
            CreatePartyCommand(
                _india(
                    company_name="Another",
                    registration_type=RegistrationType.REGULAR,
                    gstin="27ABCDE1234F1Z5",
                )
            )
        )


def test_find_duplicate_by_gstin_then_name_phone(service: PartyService) -> None:
    existing = service.create_party(
        CreatePartyCommand(_india(company_name="ACME Traders", contact_no="999"))
    )
    match = service.find_duplicate(_india(company_name="acme traders", contact_no="999"))
    assert match is not None and match.id == existing.id


def test_group_assignment(service: PartyService) -> None:
    conn = connect(":memory:")
    apply_pending(conn)
    groups = PartyGroupService(
        SqlitePartyGroupRepository(conn), id_generator=SequentialIdGenerator(100)
    )
    party_svc = PartyService(
        SqlitePartyRepository(conn), id_generator=SequentialIdGenerator(1), clock=_FrozenClock()
    )
    group = groups.create_group("Wholesale")
    p = party_svc.create_party(CreatePartyCommand(_india(group_id=group.id)))
    assert p.group_id == group.id


def test_group_rename_and_safe_archive(service: PartyService) -> None:
    conn = connect(":memory:")
    apply_pending(conn)
    groups = PartyGroupService(
        SqlitePartyGroupRepository(conn), id_generator=SequentialIdGenerator(100)
    )
    group = groups.create_group("Retail")
    renamed = groups.rename_group(group.id, "Retailers")
    assert renamed.name == "Retailers"
    archived = groups.archive_group(group.id)
    assert archived.is_active is False
    assert groups.list_groups() == []  # archived hidden but not deleted
