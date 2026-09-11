-- Migration 0003: unified Customer / Vendor (Party) master (V2 Feature 1).
--
-- Introduces `party_groups` and `parties`. A single party record supports the
-- customer role, the vendor role, or both (CUSTOMER_VENDOR) so a dual-role
-- business is never duplicated (product rules, section 7).
--
-- Existing invoices reference customers by `invoices.customer_id` REFERENCES
-- customers(id) and embed the customer inside the immutable finalized snapshot.
-- To preserve every historical invoice (product rules, section 19), the legacy
-- `customers` table is retained as the invoice-facing customer projection, and
-- every existing customer row is migrated into `parties` with the SAME UUID.
-- The application keeps the two in sync: saving a customer-capable party mirrors
-- it into `customers` (same id), so invoice selection, finalization, snapshot
-- reproduction and PDF generation continue to work unchanged.
--
-- Money is stored as INTEGER paise (DECISIONS D-004). Optional numeric fields
-- (E-Way Bill distance, credit limit, due days) are nullable so a blank value
-- persists as NULL rather than a fabricated zero (product rules, section 10).

CREATE TABLE party_groups (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE UNIQUE INDEX ux_party_groups_name_active
    ON party_groups (name)
    WHERE is_active = 1;

CREATE TABLE parties (
    id                        TEXT PRIMARY KEY NOT NULL,
    company_id                TEXT REFERENCES companies(id),
    company_type              TEXT NOT NULL DEFAULT 'CUSTOMER'
                                  CHECK (company_type IN ('CUSTOMER', 'VENDOR', 'CUSTOMER_VENDOR')),
    company_name              TEXT NOT NULL DEFAULT '',
    contact_person            TEXT NOT NULL DEFAULT '',
    contact_no                TEXT NOT NULL DEFAULT '',
    email                     TEXT NOT NULL DEFAULT '',
    registration_type         TEXT NOT NULL DEFAULT 'UNREGISTERED'
                                  CHECK (registration_type IN
                                      ('UNREGISTERED', 'REGULAR', 'REGULAR_SEZ', 'REGULAR_UIN')),
    gstin                     TEXT NOT NULL DEFAULT '',
    pan                       TEXT NOT NULL DEFAULT '',

    -- Billing address.
    bill_address1             TEXT NOT NULL DEFAULT '',
    bill_address2             TEXT NOT NULL DEFAULT '',
    bill_landmark             TEXT NOT NULL DEFAULT '',
    bill_country              TEXT NOT NULL DEFAULT 'India',
    bill_state                TEXT NOT NULL DEFAULT '',
    bill_state_code           TEXT NOT NULL DEFAULT '',
    bill_city                 TEXT NOT NULL DEFAULT '',
    bill_pincode              TEXT NOT NULL DEFAULT '',

    -- Shipping address (optional; has_shipping flags whether it is set).
    has_shipping              INTEGER NOT NULL DEFAULT 0 CHECK (has_shipping IN (0, 1)),
    ship_address1             TEXT NOT NULL DEFAULT '',
    ship_address2             TEXT NOT NULL DEFAULT '',
    ship_landmark             TEXT NOT NULL DEFAULT '',
    ship_country              TEXT NOT NULL DEFAULT 'India',
    ship_state                TEXT NOT NULL DEFAULT '',
    ship_state_code           TEXT NOT NULL DEFAULT '',
    ship_city                 TEXT NOT NULL DEFAULT '',
    ship_pincode              TEXT NOT NULL DEFAULT '',

    distance_for_eway_bill_km TEXT,           -- decimal string; NULL when blank
    group_id                  TEXT REFERENCES party_groups(id),

    bank_name                 TEXT NOT NULL DEFAULT '',
    bank_ifsc_code            TEXT NOT NULL DEFAULT '',
    bank_account_number       TEXT NOT NULL DEFAULT '',

    fax_no                    TEXT NOT NULL DEFAULT '',
    website                   TEXT NOT NULL DEFAULT '',
    credit_limit_paise        INTEGER,        -- NULL when blank
    due_days                  INTEGER,        -- NULL when blank
    note                      TEXT NOT NULL DEFAULT '',
    visible_on_documents      INTEGER NOT NULL DEFAULT 0
                                  CHECK (visible_on_documents IN (0, 1)),

    custom_field_1            TEXT NOT NULL DEFAULT '',
    custom_field_2            TEXT NOT NULL DEFAULT '',
    custom_field_3            TEXT NOT NULL DEFAULT '',

    customer_balance_type     TEXT NOT NULL DEFAULT 'DEBIT'
                                  CHECK (customer_balance_type IN ('DEBIT', 'CREDIT')),
    customer_balance_paise    INTEGER NOT NULL DEFAULT 0,
    vendor_balance_type       TEXT NOT NULL DEFAULT 'DEBIT'
                                  CHECK (vendor_balance_type IN ('DEBIT', 'CREDIT')),
    vendor_balance_paise      INTEGER NOT NULL DEFAULT 0,

    is_active                 INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at                TEXT NOT NULL DEFAULT '',
    updated_at                TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_parties_company_type ON parties (company_type);
CREATE INDEX ix_parties_is_active ON parties (is_active);
CREATE INDEX ix_parties_gstin ON parties (gstin);
CREATE INDEX ix_parties_group_id ON parties (group_id);

-- Migrate every existing customer into parties with the SAME id so invoices
-- (invoices.customer_id) keep resolving and finalized snapshots are unaffected.
-- Existing customers become CUSTOMER-type parties; billing state/city are copied
-- from the legacy bill_* columns. The legacy `customers` table is retained.
INSERT INTO parties (
    id, company_id, company_type, company_name, contact_no, email,
    gstin, bill_address1, bill_state, bill_state_code,
    is_active, created_at, updated_at
)
SELECT
    c.id,
    c.company_id,
    'CUSTOMER',
    c.name,
    c.phone,
    c.email,
    c.gstin,
    c.bill_line,
    c.bill_state_name,
    c.bill_state_code,
    c.is_active,
    '',
    ''
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.id = c.id);
