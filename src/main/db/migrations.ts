import type Database from 'better-sqlite3';

/**
 * Schema migrations. Faithful port of the Python migration 0001 (DECISIONS
 * D-004, D-023, D-024):
 *   - All entity ids / FKs are UUID TEXT (canonical lowercase). No AUTOINCREMENT.
 *   - Money is INTEGER paise; quantity INTEGER millis; percent INTEGER hundredths.
 *   - invoice_number is NULL until finalization; a partial UNIQUE index makes
 *     issued numbers unique (final integrity backstop, D-028).
 *   - Lifecycle/payment status constrained by CHECK.
 *   - Deleting a draft cascades to its line items.
 *
 * Migrations run inside a transaction and record applied versions in
 * schema_migrations so a fresh database gets the schema on first launch.
 */

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const MIGRATION_0001: Migration = {
  version: 1,
  name: 'initial',
  sql: `
CREATE TABLE assets (
    id           TEXT PRIMARY KEY NOT NULL,
    kind         TEXT NOT NULL,
    version      INTEGER NOT NULL DEFAULT 1,
    sha256       TEXT NOT NULL,
    stored_path  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

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
    references_json         TEXT NOT NULL DEFAULT '{}',
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
    taxable_paise          INTEGER,
    cgst_paise             INTEGER,
    sgst_paise             INTEGER,
    igst_paise             INTEGER
);

CREATE INDEX ix_invoice_items_invoice_id ON invoice_items (invoice_id);

CREATE TABLE app_settings (
    key    TEXT PRIMARY KEY NOT NULL,
    value  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE restore_metadata (
    id                       INTEGER PRIMARY KEY CHECK (id = 1),
    reconciliation_pending   INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_pending IN (0, 1)),
    trusted_state_json       TEXT NOT NULL DEFAULT '[]'
);
`,
};

/**
 * Migration 0003: unified Customer / Vendor (Party) master (V2 Feature 1).
 * Faithful port of the Python 0003_parties.sql. Introduces party_groups and
 * parties. Existing customers are copied into parties with the SAME UUID so
 * invoices keep resolving; the legacy customers table is retained as the
 * invoice-facing projection.
 */
const MIGRATION_0003: Migration = {
  version: 3,
  name: 'parties',
  sql: `
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

    bill_address1             TEXT NOT NULL DEFAULT '',
    bill_address2             TEXT NOT NULL DEFAULT '',
    bill_landmark             TEXT NOT NULL DEFAULT '',
    bill_country              TEXT NOT NULL DEFAULT 'India',
    bill_state                TEXT NOT NULL DEFAULT '',
    bill_state_code           TEXT NOT NULL DEFAULT '',
    bill_city                 TEXT NOT NULL DEFAULT '',
    bill_pincode              TEXT NOT NULL DEFAULT '',

    has_shipping              INTEGER NOT NULL DEFAULT 0 CHECK (has_shipping IN (0, 1)),
    ship_address1             TEXT NOT NULL DEFAULT '',
    ship_address2             TEXT NOT NULL DEFAULT '',
    ship_landmark             TEXT NOT NULL DEFAULT '',
    ship_country              TEXT NOT NULL DEFAULT 'India',
    ship_state                TEXT NOT NULL DEFAULT '',
    ship_state_code           TEXT NOT NULL DEFAULT '',
    ship_city                 TEXT NOT NULL DEFAULT '',
    ship_pincode              TEXT NOT NULL DEFAULT '',

    distance_for_eway_bill_km TEXT,
    group_id                  TEXT REFERENCES party_groups(id),

    bank_name                 TEXT NOT NULL DEFAULT '',
    bank_ifsc_code            TEXT NOT NULL DEFAULT '',
    bank_account_number       TEXT NOT NULL DEFAULT '',

    fax_no                    TEXT NOT NULL DEFAULT '',
    website                   TEXT NOT NULL DEFAULT '',
    credit_limit_paise        INTEGER,
    due_days                  INTEGER,
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

INSERT INTO parties (
    id, company_id, company_type, company_name, contact_no, email,
    gstin, bill_address1, bill_state, bill_state_code,
    is_active, created_at, updated_at
)
SELECT
    c.id, c.company_id, 'CUSTOMER', c.name, c.phone, c.email,
    c.gstin, c.bill_line, c.bill_state_name, c.bill_state_code,
    c.is_active, '', ''
FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM parties p WHERE p.id = c.id);
`,
};

/**
 * Migration 0004: Product / Service master (V2 Feature 2). Faithful port of the
 * Python 0004_products.sql. Money as INTEGER paise; tax/discount as decimal
 * strings; optional quantities nullable TEXT.
 */
const MIGRATION_0004: Migration = {
  version: 4,
  name: 'products',
  sql: `
CREATE TABLE product_groups (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL DEFAULT '',
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);

CREATE UNIQUE INDEX ux_product_groups_name_active
    ON product_groups (name)
    WHERE is_active = 1;

CREATE TABLE products (
    id                        TEXT PRIMARY KEY NOT NULL,
    company_id                TEXT REFERENCES companies(id),
    item_type                 TEXT NOT NULL DEFAULT 'PRODUCT'
                                  CHECK (item_type IN ('PRODUCT', 'SERVICE', 'ADDITIONAL_CHARGES')),

    name                      TEXT NOT NULL DEFAULT '',
    note                      TEXT NOT NULL DEFAULT '',
    barcode_no                TEXT NOT NULL DEFAULT '',
    hsn_sac_code              TEXT NOT NULL DEFAULT '',
    unit_of_measurement       TEXT NOT NULL DEFAULT '',

    tax_rate                  TEXT NOT NULL DEFAULT '0',
    cess_percent              TEXT NOT NULL DEFAULT '0',
    cess_type                 TEXT NOT NULL DEFAULT 'FIXED'
                                  CHECK (cess_type IN ('FIXED', 'PER_UNIT')),
    cess_amount_paise         INTEGER NOT NULL DEFAULT 0,
    no_itc                    INTEGER NOT NULL DEFAULT 0 CHECK (no_itc IN (0, 1)),

    sell_price_paise              INTEGER NOT NULL DEFAULT 0,
    sell_price_incl_tax_paise     INTEGER NOT NULL DEFAULT 0,
    sale_discount_type            TEXT NOT NULL DEFAULT 'RUPEE'
                                      CHECK (sale_discount_type IN ('RUPEE', 'PERCENTAGE')),
    sale_discount_value           TEXT NOT NULL DEFAULT '0',
    purchase_price_paise          INTEGER NOT NULL DEFAULT 0,
    purchase_price_incl_tax_paise INTEGER NOT NULL DEFAULT 0,
    purchase_discount_type        TEXT NOT NULL DEFAULT 'RUPEE'
                                      CHECK (purchase_discount_type IN ('RUPEE', 'PERCENTAGE')),
    purchase_discount_value       TEXT NOT NULL DEFAULT '0',

    stock_type                TEXT NOT NULL DEFAULT 'NORMAL'
                                  CHECK (stock_type IN ('NORMAL', 'BATCH', 'SERIAL')),
    opening_qty               TEXT,
    low_stock_alert           TEXT,

    product_group_id          TEXT REFERENCES product_groups(id),
    image_asset_id            TEXT,

    is_manufactured           INTEGER NOT NULL DEFAULT 0 CHECK (is_manufactured IN (0, 1)),
    is_sellable               INTEGER NOT NULL DEFAULT 1 CHECK (is_sellable IN (0, 1)),
    visible_on_documents      INTEGER NOT NULL DEFAULT 0 CHECK (visible_on_documents IN (0, 1)),

    is_active                 INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at                TEXT NOT NULL DEFAULT '',
    updated_at                TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_products_item_type ON products (item_type);
CREATE INDEX ix_products_is_active ON products (is_active);
CREATE INDEX ix_products_is_sellable ON products (is_sellable);
CREATE INDEX ix_products_barcode ON products (barcode_no);
CREATE INDEX ix_products_hsn_sac ON products (hsn_sac_code);
CREATE INDEX ix_products_group_id ON products (product_group_id);
CREATE INDEX ix_products_name ON products (name COLLATE NOCASE);
`,
};

/**
 * Migration 0005: append-only stock ledger. Current stock is always DERIVED as
 * the sum of movement deltas (never a stored mutable column), same principle as
 * invoice numbering. Quantities are exact integer millis (3 dp). An OPENING
 * movement is backfilled from each product's opening_qty so history is
 * consistent from day one. Auto-post from sales/purchases is intentionally not
 * wired here (manual + bulk only); the reason set leaves room for it later.
 */
const MIGRATION_0005: Migration = {
  version: 5,
  name: 'stock_movements',
  sql: `
CREATE TABLE stock_movements (
    id             TEXT PRIMARY KEY NOT NULL,
    product_id     TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    delta_millis   INTEGER NOT NULL DEFAULT 0,
    reason         TEXT NOT NULL DEFAULT 'ADJUSTMENT'
                       CHECK (reason IN ('OPENING', 'ADJUSTMENT', 'SALE', 'PURCHASE', 'RESTORE')),
    reference_type TEXT NOT NULL DEFAULT 'MANUAL',
    reference_id   TEXT,
    remarks        TEXT NOT NULL DEFAULT '',
    created_at     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_stock_movements_product ON stock_movements (product_id);
CREATE INDEX ix_stock_movements_reference ON stock_movements (reference_id);
CREATE INDEX ix_stock_movements_created ON stock_movements (created_at);

-- The OPENING backfill (from each product's opening_qty) runs in the
-- application layer after migration, so movement ids are proper UUID4s that
-- pass the repository's canonical-UUID validation. It is idempotent: a product
-- that already has an OPENING movement is skipped.
`,
};

/**
 * Migration 0006: Delivery Challan document (V2 Feature). A challan is a
 * movement-of-goods document (OUTWARD/INWARD) whose counterparty may be a
 * customer OR a vendor. It reuses the shared `invoice_sequences` table for
 * numbering (with its own prefix), the calculation engine, and the same
 * immutable-snapshot model as invoices. challan_number is NULL until finalized;
 * a partial UNIQUE index makes issued numbers unique (D-028). Deleting a draft
 * cascades to its line items. Money as INTEGER paise, quantity millis, percent
 * hundredths — identical scales to invoices.
 */
const MIGRATION_0006: Migration = {
  version: 6,
  name: 'challans',
  sql: `
CREATE TABLE challans (
    id                      TEXT PRIMARY KEY NOT NULL,
    company_id              TEXT REFERENCES companies(id),
    party_id                TEXT REFERENCES parties(id),
    status                  TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
    direction               TEXT NOT NULL DEFAULT 'OUTWARD'
                                CHECK (direction IN ('OUTWARD', 'INWARD')),
    challan_type            TEXT NOT NULL DEFAULT 'OTHER'
                                CHECK (challan_type IN
                                    ('SUPPLY_ON_APPROVAL', 'JOB_WORK', 'SUPPLY_LIQUID_GAS', 'OTHER')),
    challan_number          TEXT,
    challan_date            TEXT NOT NULL DEFAULT '',
    place_of_supply_state   TEXT NOT NULL DEFAULT '',
    place_of_supply_code    TEXT NOT NULL DEFAULT '',
    reverse_charge          INTEGER NOT NULL DEFAULT 0 CHECK (reverse_charge IN (0, 1)),
    reason_for_eway         TEXT NOT NULL DEFAULT '',
    delivery_mode           TEXT NOT NULL DEFAULT '',

    party_name              TEXT NOT NULL DEFAULT '',
    party_gstin             TEXT NOT NULL DEFAULT '',
    party_pan               TEXT NOT NULL DEFAULT '',
    party_phone             TEXT NOT NULL DEFAULT '',
    party_contact_person    TEXT NOT NULL DEFAULT '',
    party_address_line      TEXT NOT NULL DEFAULT '',
    party_state_name        TEXT NOT NULL DEFAULT '',
    party_state_code        TEXT NOT NULL DEFAULT '',
    party_godown            TEXT NOT NULL DEFAULT '',

    ship_line               TEXT NOT NULL DEFAULT '',
    ship_state_name         TEXT NOT NULL DEFAULT '',
    ship_state_code         TEXT NOT NULL DEFAULT '',
    ship_godown             TEXT NOT NULL DEFAULT '',

    template_version        INTEGER,
    notes                   TEXT NOT NULL DEFAULT '',
    terms                   TEXT NOT NULL DEFAULT '',
    document_note           TEXT NOT NULL DEFAULT '',

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
    created_at              TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX ux_challans_challan_number
    ON challans (challan_number)
    WHERE challan_number IS NOT NULL;

CREATE INDEX ix_challans_party_id ON challans (party_id);

CREATE TABLE challan_items (
    id                     TEXT PRIMARY KEY NOT NULL,
    challan_id             TEXT NOT NULL REFERENCES challans(id) ON DELETE CASCADE,
    sequence               INTEGER NOT NULL DEFAULT 0,
    description            TEXT NOT NULL DEFAULT '',
    hsn_sac                TEXT NOT NULL DEFAULT '',
    quantity_millis        INTEGER NOT NULL DEFAULT 0,
    unit                   TEXT NOT NULL DEFAULT '',
    rate_paise             INTEGER NOT NULL DEFAULT 0,
    discount_hundredths    INTEGER NOT NULL DEFAULT 0,
    tax_treatment          TEXT NOT NULL DEFAULT 'TAXABLE'
                               CHECK (tax_treatment IN ('TAXABLE')),
    tax_rate_hundredths    INTEGER NOT NULL DEFAULT 0,
    note                   TEXT NOT NULL DEFAULT '',
    taxable_paise          INTEGER,
    cgst_paise             INTEGER,
    sgst_paise             INTEGER,
    igst_paise             INTEGER
);

CREATE INDEX ix_challan_items_challan_id ON challan_items (challan_id);
`,
};

/**
 * Migration 0007: add Motor Vehicle No. to challans (e-way bill transport
 * detail). Additive column with a safe default so existing rows are unaffected.
 */
const MIGRATION_0007: Migration = {
  version: 7,
  name: 'challan_vehicle_no',
  sql: `
ALTER TABLE challans ADD COLUMN vehicle_no TEXT NOT NULL DEFAULT '';
`,
};

/**
 * Migration 0008: Order documents (Sales Order / Purchase Order / Service
 * Request). A pre-invoice document whose counterparty is a customer or a vendor
 * and whose lines may be products or services. Reuses the shared
 * `invoice_sequences` table for numbering (own prefix per type), the calc
 * engine, and the immutable-snapshot model. order_number is NULL until CONFIRMED;
 * a partial UNIQUE index makes issued numbers unique. Deleting a draft cascades
 * to its line items. Money paise, quantity millis, percent hundredths.
 */
const MIGRATION_0008: Migration = {
  version: 8,
  name: 'orders',
  sql: `
CREATE TABLE orders (
    id                      TEXT PRIMARY KEY NOT NULL,
    company_id              TEXT REFERENCES companies(id),
    party_id                TEXT REFERENCES parties(id),
    order_type              TEXT NOT NULL DEFAULT 'SALES_ORDER'
                                CHECK (order_type IN
                                    ('SALES_ORDER', 'PURCHASE_ORDER', 'SERVICE_REQUEST')),
    status                  TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED')),
    order_number            TEXT,
    order_date              TEXT NOT NULL DEFAULT '',
    place_of_supply_state   TEXT NOT NULL DEFAULT '',
    place_of_supply_code    TEXT NOT NULL DEFAULT '',
    reverse_charge          INTEGER NOT NULL DEFAULT 0 CHECK (reverse_charge IN (0, 1)),
    delivery_mode           TEXT NOT NULL DEFAULT '',

    party_name              TEXT NOT NULL DEFAULT '',
    party_gstin             TEXT NOT NULL DEFAULT '',
    party_pan               TEXT NOT NULL DEFAULT '',
    party_phone             TEXT NOT NULL DEFAULT '',
    party_contact_person    TEXT NOT NULL DEFAULT '',
    party_address_line      TEXT NOT NULL DEFAULT '',
    party_state_name        TEXT NOT NULL DEFAULT '',
    party_state_code        TEXT NOT NULL DEFAULT '',
    party_godown            TEXT NOT NULL DEFAULT '',

    ship_line               TEXT NOT NULL DEFAULT '',
    ship_state_name         TEXT NOT NULL DEFAULT '',
    ship_state_code         TEXT NOT NULL DEFAULT '',
    ship_godown             TEXT NOT NULL DEFAULT '',

    template_version        INTEGER,
    notes                   TEXT NOT NULL DEFAULT '',
    terms                   TEXT NOT NULL DEFAULT '',
    document_note           TEXT NOT NULL DEFAULT '',

    total_taxable_paise     INTEGER NOT NULL DEFAULT 0,
    total_cgst_paise        INTEGER NOT NULL DEFAULT 0,
    total_sgst_paise        INTEGER NOT NULL DEFAULT 0,
    total_igst_paise        INTEGER NOT NULL DEFAULT 0,
    raw_total_paise         INTEGER NOT NULL DEFAULT 0,
    round_off_paise         INTEGER NOT NULL DEFAULT 0,
    grand_total_paise       INTEGER NOT NULL DEFAULT 0,
    snapshot_json           TEXT,
    converted_invoice_id    TEXT REFERENCES invoices(id),
    cancelled_at            TEXT NOT NULL DEFAULT '',
    cancel_reason           TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX ux_orders_order_number
    ON orders (order_number)
    WHERE order_number IS NOT NULL;

CREATE INDEX ix_orders_party_id ON orders (party_id);
CREATE INDEX ix_orders_order_type ON orders (order_type);

CREATE TABLE order_items (
    id                     TEXT PRIMARY KEY NOT NULL,
    order_id               TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    sequence               INTEGER NOT NULL DEFAULT 0,
    item_type              TEXT NOT NULL DEFAULT 'PRODUCT'
                               CHECK (item_type IN ('PRODUCT', 'SERVICE')),
    product_id             TEXT REFERENCES products(id),
    description            TEXT NOT NULL DEFAULT '',
    hsn_sac                TEXT NOT NULL DEFAULT '',
    quantity_millis        INTEGER NOT NULL DEFAULT 0,
    unit                   TEXT NOT NULL DEFAULT '',
    rate_paise             INTEGER NOT NULL DEFAULT 0,
    discount_hundredths    INTEGER NOT NULL DEFAULT 0,
    tax_treatment          TEXT NOT NULL DEFAULT 'TAXABLE'
                               CHECK (tax_treatment IN ('TAXABLE')),
    tax_rate_hundredths    INTEGER NOT NULL DEFAULT 0,
    note                   TEXT NOT NULL DEFAULT '',
    taxable_paise          INTEGER,
    cgst_paise             INTEGER,
    sgst_paise             INTEGER,
    igst_paise             INTEGER
);

CREATE INDEX ix_order_items_order_id ON order_items (order_id);
`,
};

/**
 * Migration 0009: common invoice structure with a kind discriminator plus
 * source-document / payment metadata, and per-line item type. Additive columns
 * with safe defaults so existing invoices are unaffected (kind SALES,
 * item_type PRODUCT). A PURCHASE invoice bills a vendor (party_id) and leaves
 * customer_id null; SALES/JOB_WORK/CUSTOM keep customer_id.
 */
const MIGRATION_0009: Migration = {
  version: 9,
  name: 'invoice_kinds',
  sql: `
ALTER TABLE invoices ADD COLUMN kind TEXT NOT NULL DEFAULT 'SALES'
    CHECK (kind IN ('SALES', 'JOB_WORK', 'PURCHASE', 'CUSTOM'));
ALTER TABLE invoices ADD COLUMN party_id TEXT REFERENCES parties(id);
ALTER TABLE invoices ADD COLUMN payment_mode TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN payment_type TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN source_document_type TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN source_document_number TEXT NOT NULL DEFAULT '';
ALTER TABLE invoices ADD COLUMN source_document_id TEXT;

ALTER TABLE invoice_items ADD COLUMN item_type TEXT NOT NULL DEFAULT 'PRODUCT'
    CHECK (item_type IN ('PRODUCT', 'SERVICE'));
ALTER TABLE invoice_items ADD COLUMN product_id TEXT REFERENCES products(id);
`,
};

/**
 * Migration 0010: let a Delivery Challan reference a source order (e.g. a
 * Service Request) so its detail can prefill and an invoice can cite both the
 * challan and the buyer's order. Additive columns, default empty.
 */
const MIGRATION_0010: Migration = {
  version: 10,
  name: 'challan_source_order',
  sql: `
ALTER TABLE challans ADD COLUMN source_order_number TEXT NOT NULL DEFAULT '';
ALTER TABLE challans ADD COLUMN source_order_id TEXT REFERENCES orders(id);
`,
};

/**
 * Migration 0011: Receipt / Payment vouchers (V2 Feature). A voucher records
 * money moving in (RECEIPT, from a customer) or out (PAYMENT, to a vendor). It
 * is a STANDALONE document that may be allocated across one or more invoices,
 * or left unallocated (advance / deposit). It reuses the shared
 * `invoice_sequences` table for numbering (own prefix per direction), and the
 * immutable-snapshot model. payment_number is NULL until FINALIZED; a partial
 * UNIQUE index makes issued numbers unique (D-028).
 *
 * Invoice payment_status / outstanding are DERIVED from CONFIRMED allocations
 * only (DECISIONS D-032); a DRAFT allocation never affects the invoice.
 * Deleting a draft voucher cascades to its allocations. Money as INTEGER paise.
 */
const MIGRATION_0011: Migration = {
  version: 11,
  name: 'payments',
  sql: `
CREATE TABLE payments (
    id                      TEXT PRIMARY KEY NOT NULL,
    company_id              TEXT REFERENCES companies(id),
    party_id                TEXT REFERENCES parties(id),
    direction               TEXT NOT NULL DEFAULT 'RECEIPT'
                                CHECK (direction IN ('RECEIPT', 'PAYMENT')),
    status                  TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT', 'FINALIZED', 'CANCELLED')),
    payment_number          TEXT,
    payment_date            TEXT NOT NULL DEFAULT '',
    amount_paise            INTEGER NOT NULL DEFAULT 0,
    mode                    TEXT NOT NULL DEFAULT 'CASH'
                                CHECK (mode IN
                                    ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'CARD', 'OTHER')),
    reference_no            TEXT NOT NULL DEFAULT '',
    remarks                 TEXT NOT NULL DEFAULT '',

    party_name              TEXT NOT NULL DEFAULT '',
    party_gstin             TEXT NOT NULL DEFAULT '',
    party_pan               TEXT NOT NULL DEFAULT '',
    party_phone             TEXT NOT NULL DEFAULT '',
    party_address_line      TEXT NOT NULL DEFAULT '',
    party_state_name        TEXT NOT NULL DEFAULT '',
    party_state_code        TEXT NOT NULL DEFAULT '',
    party_godown            TEXT NOT NULL DEFAULT '',

    snapshot_json           TEXT,
    cancelled_at            TEXT NOT NULL DEFAULT '',
    cancel_reason           TEXT NOT NULL DEFAULT '',
    created_at              TEXT NOT NULL DEFAULT '',
    updated_at              TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX ux_payments_payment_number
    ON payments (payment_number)
    WHERE payment_number IS NOT NULL;

CREATE INDEX ix_payments_party_id ON payments (party_id);
CREATE INDEX ix_payments_direction ON payments (direction);

CREATE TABLE payment_allocations (
    id             TEXT PRIMARY KEY NOT NULL,
    payment_id     TEXT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id     TEXT NOT NULL REFERENCES invoices(id),
    invoice_number TEXT NOT NULL DEFAULT '',
    amount_paise   INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (status IN ('DRAFT', 'CONFIRMED'))
);

CREATE INDEX ix_payment_allocations_payment_id ON payment_allocations (payment_id);
CREATE INDEX ix_payment_allocations_invoice_id ON payment_allocations (invoice_id);
`,
};

/**
 * Migration 0012: Manufacturing and Bill of Materials (BOM).
 *
 * Adds:
 *   - product_boms: recipe lines linking a finished product to raw material products with quantity
 *   - production_batches: production runs recording quantity made, cost, date, notes, and materials
 *   - products.made_here: flag marking products that are manufactured from raw materials
 */
const MIGRATION_0012: Migration = {
  version: 12,
  name: 'manufacturing_bom',
  sql: `
ALTER TABLE products ADD COLUMN made_here INTEGER NOT NULL DEFAULT 0 CHECK (made_here IN (0, 1));

CREATE TABLE product_boms (
    id                  TEXT PRIMARY KEY NOT NULL,
    product_id          TEXT NOT NULL REFERENCES products(id),
    raw_product_id      TEXT NOT NULL REFERENCES products(id),
    quantity            TEXT NOT NULL DEFAULT '1',
    created_at          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_product_boms_product_id ON product_boms (product_id);
CREATE INDEX ix_product_boms_raw_product_id ON product_boms (raw_product_id);

CREATE TABLE production_batches (
    id                  TEXT PRIMARY KEY NOT NULL,
    product_id          TEXT NOT NULL REFERENCES products(id),
    product_name        TEXT NOT NULL DEFAULT '',
    unit                TEXT NOT NULL DEFAULT 'NOS',
    quantity            TEXT NOT NULL DEFAULT '1',
    production_date     TEXT NOT NULL DEFAULT '',
    cost_paise          INTEGER NOT NULL DEFAULT 0,
    note                TEXT NOT NULL DEFAULT '',
    materials_json      TEXT NOT NULL DEFAULT '[]',
    created_at          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_production_batches_product_id ON production_batches (product_id);
CREATE INDEX ix_production_batches_date ON production_batches (production_date);
`,
};

/**
 * Migration 0013: Daily Cash Book & Cost Centres.
 *
 * Adds:
 *   - cash_entries: daily workshop cash in and cash out transactions
 *   - cost_centres: machine and project tracking for job profitability
 */
const MIGRATION_0013: Migration = {
  version: 13,
  name: 'cash_and_cost_centres',
  sql: `
CREATE TABLE cash_entries (
    id                  TEXT PRIMARY KEY NOT NULL,
    type                TEXT NOT NULL CHECK (type IN ('in', 'out')),
    amount_paise        INTEGER NOT NULL DEFAULT 0,
    entry_date          TEXT NOT NULL DEFAULT '',
    name                TEXT NOT NULL DEFAULT '',
    note                TEXT NOT NULL DEFAULT '',
    category            TEXT NOT NULL DEFAULT 'Other',
    created_at          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_cash_entries_date ON cash_entries (entry_date);

CREATE TABLE cost_centres (
    id                  TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL DEFAULT '',
    code                TEXT NOT NULL DEFAULT '',
    is_archived         INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    created_at          TEXT NOT NULL DEFAULT ''
);

CREATE UNIQUE INDEX ux_cost_centres_name ON cost_centres (name) WHERE is_archived = 0;
`,
};

/**
 * Migration 0014: App Security & PIN Lock.
 *
 * Stores hashed PIN and security configuration locally.
 */
const MIGRATION_0014: Migration = {
  version: 14,
  name: 'app_lock_security',
  sql: `
CREATE TABLE app_security (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    pin_hash            TEXT NOT NULL DEFAULT '',
    salt                TEXT NOT NULL DEFAULT '',
    enabled             INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    pin_length          INTEGER NOT NULL DEFAULT 4,
    updated_at          TEXT NOT NULL DEFAULT ''
);

INSERT OR IGNORE INTO app_security (id, pin_hash, salt, enabled, pin_length, updated_at)
VALUES (1, '', '', 0, 4, '');
`,
};

const MIGRATIONS: Migration[] = [
  MIGRATION_0001,
  MIGRATION_0003,
  MIGRATION_0004,
  MIGRATION_0005,
  MIGRATION_0006,
  MIGRATION_0007,
  MIGRATION_0008,
  MIGRATION_0009,
  MIGRATION_0010,
  MIGRATION_0011,
  MIGRATION_0012,
  MIGRATION_0013,
  MIGRATION_0014,
];

export function applyPending(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY NOT NULL,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedRow = db
    .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
    .get() as { v: number };
  const currentVersion = appliedRow.v;

  const record = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  );

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version,
  );

  for (const migration of pending) {
    const run = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, new Date().toISOString());
    });
    run();
  }
}
