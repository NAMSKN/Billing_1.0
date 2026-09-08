-- Migration 0001: initial schema.
--
-- Conventions (DECISIONS D-004, D-023, D-024; design section 7):
--   * All entity ids and foreign keys are UUID TEXT (canonical lowercase).
--     No INTEGER/AUTOINCREMENT primary keys for domain entities.
--   * Money is stored as INTEGER paise (2 dp). Quantity as INTEGER millis
--     (3 dp). Percentages as INTEGER hundredths (2 dp).
--   * invoice_number is NULL until finalization; a partial UNIQUE index makes
--     issued numbers unique (the final integrity backstop, D-028).
--   * Lifecycle/payment status values are constrained by CHECK.
--   * Deleting a draft invoice cascades to its line items; finalized/cancelled
--     invoices are not hard-deleted through normal workflows (enforced by the
--     application layer, Req 23.5).

CREATE TABLE companies (
    id                    TEXT PRIMARY KEY NOT NULL,
    name                  TEXT NOT NULL DEFAULT '',
    address_line          TEXT NOT NULL DEFAULT '',
    state_name            TEXT NOT NULL DEFAULT '',
    state_code            TEXT NOT NULL DEFAULT '',
    gstin                 TEXT NOT NULL DEFAULT '',
    email                 TEXT NOT NULL DEFAULT '',
    phone                 TEXT NOT NULL DEFAULT '',
    bank_name             TEXT NOT NULL DEFAULT '',
    account_number        TEXT NOT NULL DEFAULT '',
    branch                TEXT NOT NULL DEFAULT '',
    ifsc                  TEXT NOT NULL DEFAULT '',
    upi_id                TEXT NOT NULL DEFAULT '',
    authorized_signatory  TEXT NOT NULL DEFAULT '',
    logo_asset_id         TEXT REFERENCES assets(id),
    signature_asset_id    TEXT REFERENCES assets(id),
    active                INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE customers (
    id                TEXT PRIMARY KEY NOT NULL,
    company_id        TEXT REFERENCES companies(id),
    name              TEXT NOT NULL DEFAULT '',
    gstin             TEXT NOT NULL DEFAULT '',
    phone             TEXT NOT NULL DEFAULT '',
    email             TEXT NOT NULL DEFAULT '',
    bill_line         TEXT NOT NULL DEFAULT '',
    bill_state_name   TEXT NOT NULL DEFAULT '',
    bill_state_code   TEXT NOT NULL DEFAULT '',
    bill_godown       TEXT NOT NULL DEFAULT '',
    ship_line         TEXT NOT NULL DEFAULT '',
    ship_state_name   TEXT NOT NULL DEFAULT '',
    ship_state_code   TEXT NOT NULL DEFAULT '',
    ship_godown       TEXT NOT NULL DEFAULT '',
    is_active         INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE TABLE assets (
    id           TEXT PRIMARY KEY NOT NULL,
    kind         TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    sha256       TEXT NOT NULL,
    stored_path  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE TABLE numbering_config (
    company_id   TEXT NOT NULL REFERENCES companies(id),
    scope        TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    pad_width    INTEGER NOT NULL DEFAULT 3,
    start_value  INTEGER NOT NULL DEFAULT 1,
    fy_scheme    TEXT NOT NULL DEFAULT 'IN',
    PRIMARY KEY (company_id, scope)
);

CREATE TABLE invoice_sequences (
    company_id       TEXT NOT NULL REFERENCES companies(id),
    financial_year   TEXT NOT NULL,
    prefix           TEXT NOT NULL,
    next_sequence    INTEGER NOT NULL,
    high_water_mark  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (company_id, financial_year, prefix)
);

CREATE TABLE invoices (
    id                      TEXT PRIMARY KEY NOT NULL,
    company_id              TEXT REFERENCES companies(id),
    customer_id             TEXT REFERENCES customers(id),
    status                  TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
    payment_status          TEXT NOT NULL DEFAULT 'UNPAID'
                                CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID')),
    invoice_number          TEXT,
    invoice_date            TEXT NOT NULL DEFAULT '',
    place_of_supply_state   TEXT NOT NULL DEFAULT '',
    place_of_supply_code    TEXT NOT NULL DEFAULT '',
    template_version        INTEGER,
    logo_asset_id           TEXT REFERENCES assets(id),
    signature_asset_id      TEXT REFERENCES assets(id),
    payment_terms           TEXT NOT NULL DEFAULT '',
    due_date                TEXT NOT NULL DEFAULT '',
    notes                   TEXT NOT NULL DEFAULT '',
    terms                   TEXT NOT NULL DEFAULT '',
    declaration             TEXT NOT NULL DEFAULT '',
    -- Totals, stored as INTEGER paise.
    total_taxable_paise     INTEGER NOT NULL DEFAULT 0,
    total_cgst_paise        INTEGER NOT NULL DEFAULT 0,
    total_sgst_paise        INTEGER NOT NULL DEFAULT 0,
    total_igst_paise        INTEGER NOT NULL DEFAULT 0,
    raw_total_paise         INTEGER NOT NULL DEFAULT 0,
    round_off_paise         INTEGER NOT NULL DEFAULT 0,
    grand_total_paise       INTEGER NOT NULL DEFAULT 0,
    snapshot_json           TEXT,
    cancelled_at            TEXT NOT NULL DEFAULT '',
    cancel_reason           TEXT NOT NULL DEFAULT '',
    replacement_invoice_id  TEXT REFERENCES invoices(id),
    created_at              TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT ''
);

-- Issued invoice numbers are unique; drafts (NULL) are exempt (D-028).
CREATE UNIQUE INDEX ux_invoices_invoice_number
    ON invoices (invoice_number)
    WHERE invoice_number IS NOT NULL;

CREATE TABLE invoice_items (
    id                     TEXT PRIMARY KEY NOT NULL,
    invoice_id             TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    sequence               INTEGER NOT NULL DEFAULT 0,
    job_or_mould_reference TEXT NOT NULL DEFAULT '',
    component_or_part      TEXT NOT NULL DEFAULT '',
    operation              TEXT NOT NULL DEFAULT '',
    description            TEXT NOT NULL DEFAULT '',
    specification          TEXT NOT NULL DEFAULT '',
    hsn_sac                TEXT NOT NULL DEFAULT '',
    quantity_millis        INTEGER NOT NULL DEFAULT 0,
    unit                   TEXT NOT NULL DEFAULT '',
    rate_paise             INTEGER NOT NULL DEFAULT 0,
    discount_hundredths    INTEGER NOT NULL DEFAULT 0,
    tax_treatment          TEXT NOT NULL DEFAULT 'TAXABLE'
                               CHECK (tax_treatment IN ('TAXABLE')),
    tax_rate_hundredths    INTEGER NOT NULL DEFAULT 0,
    taxable_paise          INTEGER NOT NULL DEFAULT 0,
    cgst_paise             INTEGER NOT NULL DEFAULT 0,
    sgst_paise             INTEGER NOT NULL DEFAULT 0,
    igst_paise             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX ix_invoice_items_invoice_id ON invoice_items (invoice_id);

CREATE TABLE service_templates (
    id           TEXT PRIMARY KEY NOT NULL,
    company_id   TEXT REFERENCES companies(id),
    name         TEXT NOT NULL DEFAULT '',
    description  TEXT NOT NULL DEFAULT '',
    hsn_sac      TEXT NOT NULL DEFAULT '',
    unit         TEXT NOT NULL DEFAULT ''
);

CREATE TABLE app_settings (
    key    TEXT PRIMARY KEY NOT NULL,
    value  TEXT NOT NULL DEFAULT ''
);
