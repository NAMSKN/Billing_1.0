# Customer → Party Migration (V2 Feature 1)

## What changed

The standalone Customer master is superseded by a unified **Party** (Customer /
Vendor) master. A single `parties` record supports the customer role, the
vendor role, or both (`CUSTOMER_VENDOR`).

## Schema

Migration `0003_parties.sql` (schema version 3) adds:

- `party_groups` — selectable customer/vendor groups (create / rename / archive).
- `parties` — the unified master. Money (opening balances, credit limit) is
  stored as INTEGER paise; optional numeric fields (E-Way Bill distance, credit
  limit, due days) are nullable so a blank value is stored as `NULL`.

The legacy `customers` table is **retained**. `invoices.customer_id` references
it and finalized invoice snapshots embed a `Customer`, so it remains the
invoice-facing customer projection.

## Data migration

`0003_parties.sql` copies every existing `customers` row into `parties` with the
**same UUID**, as a `CUSTOMER`-type party. Billing state/state-code are copied
from the legacy `bill_*` columns. Because ids are preserved, all existing
invoices continue to resolve their customer, and finalized snapshots are
unaffected.

The migration is additive and idempotent (`WHERE NOT EXISTS`), applied by the
standard migration runner (`apply_pending`) on first launch after upgrade. An
older database is upgraded in place; no data is discarded.

## Keeping the two in sync going forward

`PartyService` mirrors any customer-capable party (`CUSTOMER` or
`CUSTOMER_VENDOR`) into `customers` (same id) through `InvoiceCustomerProjection`
whenever it is saved. Vendor-only parties are never projected, so they cannot be
selected as a sales customer. Archiving a party deactivates its projected
customer so it drops out of new-invoice selection while remaining available for
historical documents.

## Rollback

The migration only adds tables and copies data; it does not alter or drop
`customers` or `invoices`. Restoring a pre-3 backup is safe. Re-applying 0003 is
idempotent.
