"""Composition root: the single place that wires dependencies.

Opens the SQLite connection, applies pending migrations, constructs the
repositories, then the application services via constructor injection, and
returns a plain :class:`Application` container of the wired services (DECISIONS
D-021). This is not a service locator or a global mutable container — nothing
looks dependencies up at runtime; callers receive the already-constructed
objects.

An :class:`IdGenerator` and :class:`Clock` are injectable so tests can be
deterministic (DECISIONS D-023; testing rules). The same wiring is reused by
the test factory (``tests/support/build_test_app.py``) so tests never hand-roll
incompatible wiring.

References: requirements Req 25, 30; DECISIONS D-021, D-023; design sections
20, 32, 33.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

from invoice_generator.application.clock import Clock, SystemClock
from invoice_generator.application.invoice_service import InvoiceService
from invoice_generator.application.numbering_service import NumberingService
from invoice_generator.application.pdf_service import PdfService
from invoice_generator.application.print_service import PrintService
from invoice_generator.application.settings_service import SettingsService
from invoice_generator.domain.ids import IdGenerator, Uuid4Generator
from invoice_generator.infrastructure.backup.restore import MetadataReconciliationGate
from invoice_generator.infrastructure.db.asset_repository import SqliteAssetRepository
from invoice_generator.infrastructure.db.company_repository import SqliteCompanyRepository
from invoice_generator.infrastructure.db.connection import connect
from invoice_generator.infrastructure.db.customer_repository import SqliteCustomerRepository
from invoice_generator.infrastructure.db.invoice_repository import SqliteInvoiceRepository
from invoice_generator.infrastructure.db.migrator import apply_pending
from invoice_generator.infrastructure.db.sequence_repository import SqliteSequenceRepository
from invoice_generator.infrastructure.db.service_template_repository import (
    SqliteServiceTemplateRepository,
)
from invoice_generator.infrastructure.db.settings_repository import SqliteSettingsRepository
from vendor_customer.application.party_group_service import PartyGroupService
from vendor_customer.application.party_service import PartyService
from vendor_customer.infrastructure.db.sqlite_party_group_repository import (
    SqlitePartyGroupRepository,
)
from vendor_customer.infrastructure.db.sqlite_party_repository import SqlitePartyRepository
from vendor_customer.infrastructure.integration.customer_projection import (
    InvoiceCustomerProjection,
)


@dataclass(frozen=True)
class Application:
    """The wired application: connection + services (composition-root output).

    Holds already-constructed collaborators. Callers use these directly; no
    runtime lookup occurs. ``close`` releases the database connection.
    """

    connection: sqlite3.Connection
    invoice_service: InvoiceService
    company_service_repo: SqliteCompanyRepository
    customer_service_repo: SqliteCustomerRepository
    settings_service: SettingsService
    numbering_service: NumberingService
    pdf_service: PdfService
    print_service: PrintService
    party_service: PartyService
    party_group_service: PartyGroupService

    def close(self) -> None:
        self.connection.close()


def build_application(
    database: str | Path,
    *,
    id_generator: IdGenerator | None = None,
    clock: Clock | None = None,
) -> Application:
    """Wire and return the :class:`Application` for ``database``.

    Applies pending migrations so a fresh database gets the schema on first
    use. ``id_generator``/``clock`` default to the production implementations.
    """
    connection = connect(database)
    apply_pending(connection)

    ids: IdGenerator = id_generator if id_generator is not None else Uuid4Generator()
    the_clock: Clock = clock if clock is not None else SystemClock()

    company_repo = SqliteCompanyRepository(connection)
    customer_repo = SqliteCustomerRepository(connection)
    invoice_repo = SqliteInvoiceRepository(connection)
    sequence_repo = SqliteSequenceRepository(connection)
    asset_repo = SqliteAssetRepository(connection)
    settings_repo = SqliteSettingsRepository(connection)
    service_template_repo = SqliteServiceTemplateRepository(connection)

    settings_service = SettingsService(settings_repo, service_template_repo)
    numbering_service = NumberingService(
        sequence_repo,
        reconciliation_gate=MetadataReconciliationGate(database),
    )
    pdf_service = PdfService(asset_repository=asset_repo)
    print_service = PrintService(pdf_service)

    invoice_service = InvoiceService(
        connection,
        invoice_repo,
        company_repository=company_repo,
        customer_repository=customer_repo,
        numbering_service=numbering_service,
        settings_service=settings_service,
        id_generator=ids,
        clock=the_clock,
    )

    # Customer / Vendor (Party) master. A customer-capable party is mirrored
    # into the invoice-facing `customers` table (same UUID) via the projection
    # so existing invoice selection/finalization/snapshots keep working.
    party_repo = SqlitePartyRepository(connection)
    party_group_repo = SqlitePartyGroupRepository(connection)
    party_service = PartyService(
        party_repo,
        id_generator=ids,
        clock=the_clock,
        customer_projection=InvoiceCustomerProjection(customer_repo),
    )
    party_group_service = PartyGroupService(party_group_repo, id_generator=ids)

    return Application(
        connection=connection,
        invoice_service=invoice_service,
        company_service_repo=company_repo,
        customer_service_repo=customer_repo,
        settings_service=settings_service,
        numbering_service=numbering_service,
        pdf_service=pdf_service,
        print_service=print_service,
        party_service=party_service,
        party_group_service=party_group_service,
    )


__all__ = ["Application", "build_application"]
