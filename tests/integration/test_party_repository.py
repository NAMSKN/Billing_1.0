"""Integration tests for the party repositories and migration 0003."""

from __future__ import annotations

import sqlite3
from decimal import Decimal

import pytest

from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.migrator import apply_pending
from tests.support.id_factory import SequentialIdGenerator
from vendor_customer.domain.models import (
    BalanceType,
    OpeningBalance,
    Party,
    PartyAddress,
    PartyGroup,
    PartyType,
    RegistrationType,
)
from vendor_customer.infrastructure.db.sqlite_party_group_repository import (
    SqlitePartyGroupRepository,
)
from vendor_customer.infrastructure.db.sqlite_party_repository import SqlitePartyRepository


@pytest.fixture()
def conn() -> sqlite3.Connection:
    connection = connect(":memory:")
    apply_pending(connection)
    return connection


def _party(ids: SequentialIdGenerator, **overrides: object) -> Party:
    base = dict(
        id=ids(),
        company_name="ACME Traders",
        company_type=PartyType.CUSTOMER,
        billing_address=PartyAddress(state="Maharashtra", state_code="27", city="Pune"),
    )
    base.update(overrides)
    return Party(**base)  # type: ignore[arg-type]


def test_parties_table_created_by_migration(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='parties'"
    ).fetchone()
    assert row is not None
    group_row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='party_groups'"
    ).fetchone()
    assert group_row is not None


def test_save_and_roundtrip_all_fields(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyRepository(conn)
    party = _party(
        ids,
        company_type=PartyType.CUSTOMER_VENDOR,
        registration_type=RegistrationType.REGULAR,
        gstin="27ABCDE1234F1Z5",
        pan="ABCDE1234F",
        billing_address=PartyAddress(
            address1="Plot 12", address2="MIDC", landmark="Near Gate",
            state="Maharashtra", state_code="27", city="Pune", pincode="411001",
        ),
        shipping_address=PartyAddress(state="Gujarat", state_code="24", city="Surat"),
        distance_for_eway_bill_km=Decimal("42.5"),
        bank_name="SBI", bank_ifsc_code="SBIN0001234", bank_account_number="123456",
        fax_no="0202", website="acme.example", credit_limit=Decimal("50000.00"),
        due_days=30, note="preferred", visible_on_documents=True,
        custom_field_1="c1", custom_field_2="c2", custom_field_3="c3",
        customer_balance=OpeningBalance(balance_type=BalanceType.CREDIT, amount=Decimal("100.25")),
        vendor_balance=OpeningBalance(balance_type=BalanceType.DEBIT, amount=Decimal("9.75")),
    )
    repo.save(party)
    loaded = repo.get(party.id)
    assert loaded is not None
    # Exact paise round-trip for money.
    assert loaded.customer_balance.amount == Decimal("100.25")
    assert loaded.vendor_balance.amount == Decimal("9.75")
    assert loaded.customer_balance.balance_type is BalanceType.CREDIT
    assert loaded.distance_for_eway_bill_km == Decimal("42.5")
    assert loaded.credit_limit == Decimal("50000.00")
    assert loaded.visible_on_documents is True
    assert loaded.shipping_address is not None
    assert loaded.shipping_address.city == "Surat"
    assert loaded.billing_address.pincode == "411001"
    assert loaded.custom_field_2 == "c2"


def test_shipping_none_roundtrip(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyRepository(conn)
    party = _party(ids, shipping_address=None)
    repo.save(party)
    loaded = repo.get(party.id)
    assert loaded is not None
    assert loaded.shipping_address is None


def test_role_filter_inclusive(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyRepository(conn)
    repo.save(_party(ids, company_name="Cust", company_type=PartyType.CUSTOMER))
    repo.save(_party(ids, company_name="Vend", company_type=PartyType.VENDOR))
    repo.save(_party(ids, company_name="Both", company_type=PartyType.CUSTOMER_VENDOR))

    customers = {p.company_name for p in repo.list_all(party_type=PartyType.CUSTOMER)}
    assert customers == {"Cust", "Both"}
    vendors = {p.company_name for p in repo.list_all(party_type=PartyType.VENDOR)}
    assert vendors == {"Vend", "Both"}
    everyone = {p.company_name for p in repo.list_all()}
    assert everyone == {"Cust", "Vend", "Both"}


def test_archive_hides_by_default(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyRepository(conn)
    party = _party(ids)
    repo.save(party)
    assert repo.archive(party.id) is True
    assert [p.company_name for p in repo.list_all()] == []
    # Archived party is retained and retrievable for historical documents.
    assert repo.get(party.id) is not None
    assert len(repo.list_all(include_archived=True)) == 1


def test_get_by_gstin_and_name_phone(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyRepository(conn)
    party = _party(ids, gstin="27ABCDE1234F1Z5", contact_no="9876543210")
    repo.save(party)
    assert repo.get_by_gstin("27ABCDE1234F1Z5") is not None
    assert repo.find_by_name_and_phone("acme traders", "9876543210") is not None
    assert repo.find_by_name_and_phone("Other", "9876543210") is None


def test_group_repository_crud(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    repo = SqlitePartyGroupRepository(conn)
    group = PartyGroup(id=ids(), name="Wholesale")
    repo.save(group)
    assert repo.get_by_name("wholesale") is not None
    assert [g.name for g in repo.list_all()] == ["Wholesale"]
    repo.archive(group.id)
    assert repo.list_all() == []
    assert len(repo.list_all(include_archived=True)) == 1


def test_group_reference_count(conn: sqlite3.Connection) -> None:
    ids = SequentialIdGenerator(1)
    groups = SqlitePartyGroupRepository(conn)
    parties = SqlitePartyRepository(conn)
    group = PartyGroup(id=ids(), name="VIP")
    groups.save(group)
    parties.save(_party(ids, group_id=group.id))
    assert groups.count_parties_in_group(group.id) == 1
