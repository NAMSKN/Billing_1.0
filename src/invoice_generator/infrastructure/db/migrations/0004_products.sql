-- Migration 0004: Product / Service master (V2 Feature 2).
--
-- Introduces `product_groups` and `products`. A single product record models
-- one of three business-facing item types: PRODUCT (physical, may carry stock),
-- SERVICE (non-stock), or ADDITIONAL_CHARGES (freight / packing / labour, etc.).
-- Only a PRODUCT carries stock configuration; for SERVICE / ADDITIONAL_CHARGES
-- the stock columns stay at their neutral defaults / NULL (product/service
-- rules, sections 1, 6, 16).
--
-- This migration establishes master data and the data model required for a
-- FUTURE inventory engine. It does NOT implement stock movement: `opening_qty`
-- is an optional initial/opening quantity distinct from any future
-- transactional stock ledger (product/service rules, section 7). No
-- Purchase -> Stock IN or Sales -> Stock OUT is created here.
--
-- Money is stored as INTEGER paise (DECISIONS D-004). Percentages (tax rate,
-- CESS %) and quantities are stored as decimal strings (TEXT) so an exact
-- Decimal round-trips without float. Optional numeric fields (opening quantity,
-- low-stock alert) are nullable so a blank value persists as NULL rather than a
-- fabricated zero. UUID ids are canonical lowercase TEXT (DECISIONS D-024).
--
-- The product master is independent of any party/vendor (product/service rules,
-- section 14): no vendor-specific pricing/history and no duplicate records per
-- vendor.

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
                                  CHECK (item_type IN
                                      ('PRODUCT', 'SERVICE', 'ADDITIONAL_CHARGES')),

    -- Product detail.
    name                      TEXT NOT NULL DEFAULT '',
    note                      TEXT NOT NULL DEFAULT '',
    barcode_no                TEXT NOT NULL DEFAULT '',
    hsn_sac_code              TEXT NOT NULL DEFAULT '',
    unit_of_measurement       TEXT NOT NULL DEFAULT '',

    -- Tax defaults (the calculation engine performs actual invoice tax).
    tax_rate                  TEXT NOT NULL DEFAULT '0',   -- decimal string (percent)
    cess_percent              TEXT NOT NULL DEFAULT '0',   -- decimal string (percent)
    cess_type                 TEXT NOT NULL DEFAULT 'FIXED'
                                  CHECK (cess_type IN ('FIXED', 'PER_UNIT')),
    cess_amount_paise         INTEGER NOT NULL DEFAULT 0,
    no_itc                    INTEGER NOT NULL DEFAULT 0 CHECK (no_itc IN (0, 1)),

    -- Pricing (integer paise; both exclusive and inclusive kept).
    sell_price_paise              INTEGER NOT NULL DEFAULT 0,
    sell_price_incl_tax_paise     INTEGER NOT NULL DEFAULT 0,
    sale_discount_type            TEXT NOT NULL DEFAULT 'RUPEE'
                                      CHECK (sale_discount_type IN ('RUPEE', 'PERCENTAGE')),
    sale_discount_value           TEXT NOT NULL DEFAULT '0',  -- paise if RUPEE, percent if %
    purchase_price_paise          INTEGER NOT NULL DEFAULT 0,
    purchase_price_incl_tax_paise INTEGER NOT NULL DEFAULT 0,
    purchase_discount_type        TEXT NOT NULL DEFAULT 'RUPEE'
                                      CHECK (purchase_discount_type IN ('RUPEE', 'PERCENTAGE')),
    purchase_discount_value       TEXT NOT NULL DEFAULT '0',

    -- Stock configuration (PRODUCT only; NULL quantities when blank).
    stock_type                TEXT NOT NULL DEFAULT 'NORMAL'
                                  CHECK (stock_type IN ('NORMAL', 'BATCH', 'SERIAL')),
    opening_qty               TEXT,           -- decimal string; NULL when blank
    low_stock_alert           TEXT,           -- decimal string; NULL when blank

    -- Grouping / assets.
    product_group_id          TEXT REFERENCES product_groups(id),
    image_asset_id            TEXT,

    -- Flags.
    is_manufactured           INTEGER NOT NULL DEFAULT 0 CHECK (is_manufactured IN (0, 1)),
    is_sellable               INTEGER NOT NULL DEFAULT 1 CHECK (is_sellable IN (0, 1)),
    visible_on_documents      INTEGER NOT NULL DEFAULT 0
                                  CHECK (visible_on_documents IN (0, 1)),

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
