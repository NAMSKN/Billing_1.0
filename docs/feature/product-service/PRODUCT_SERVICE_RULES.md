# Product / Service Master — Rules

Authoritative behavioural rules for the Product Master. Section numbers match
the feature brief.

## 1. Item types

- `PRODUCT` (label "Product") — physical item, may carry stock.
- `SERVICE` (label "Service") — non-stock item.
- `ADDITIONAL_CHARGES` (label "Additional Charges") — freight, packing,
  transport, labour, other configurable charges.
- Only `PRODUCT` tracks stock. The form adapts: stock controls are hidden for
  Service and Additional Charges.

## 2. Product detail

- Name is required. Note, Barcode, HSN/SAC are optional.
- Unit of Measurement is required for `PRODUCT`; optional for Service / Charges.
- The HSN/SAC **Find** button is disabled: no offline lookup source exists, so
  it is a future extension point and is not presented as working.

## 3. Tax

- Tax rate is stored as a default percentage on the product. The product stores
  tax configuration/defaults only; actual invoice tax is computed by the single
  calculation engine (DECISIONS D-006) — never recomputed here.
- CESS is optional: `cess_percent`, `cess_type` (Fixed / Per Unit),
  `cess_amount`. Defaults to zero and is never mandatory.
- `no_itc` boolean, default `false`, persisted.

## 4/5. Pricing

- Money is exact `Decimal`, persisted as integer paise. No float for money.
- Product keeps both exclusive-tax and inclusive-tax prices as entered; neither
  is silently converted/overwritten. The **exclusive** price is authoritative
  when pre-filling an invoice line.
- Discount type is explicit: `RUPEE` or `PERCENTAGE`. Sale and purchase
  discounts are stored independently.
- Services use the same price fields; services require no stock quantity.

## 6. Manage Stock (Product only)

- Stock type: `NORMAL` / `BATCH` / `SERIAL` (labels Normal / Batch / Serial No.).
- This is master-data configuration only. Batch/serial transaction engines are
  deferred; "batch configuration" is separated from "actual stock movement".

## 7. Available quantity

- `opening_qty` is an optional opening/initial quantity, distinct from any
  future transactional stock ledger. No Purchase→Stock IN / Sales→Stock OUT is
  implemented. A future stock ledger will own real-time stock.

## 8. Low stock alert

- Optional non-negative numeric threshold; blank means no threshold. Persisted
  only; no alerts are generated yet.

## 9. Product group

- Create / rename / archive. A group referenced by any product is archived, not
  deleted, so references never break. A product belongs to at most one group;
  no multi-level hierarchy.

## 10. Product images

- File-dialog selection, preview, replace, remove. Stored through the shared
  versioned asset store and referenced by asset id — never as a blob in the
  product row. Missing/dangling image references must not break product loading;
  a corrupt file produces a user-facing error.

## 11/12/13. Flags

- `is_manufactured` — master-data flag only (no BOM/production).
- `is_sellable` — when false the product cannot be selected in sales documents,
  but stays visible in the master and is not auto-archived. Non-sellable is
  **not** the same as inactive.
- `visible_on_documents` — controls document eligibility per future rules.

## 14. Product / party relation

- A product is independent master data. No vendor-specific history; no duplicate
  product records per party.

## 16. Item-type business rules

- PRODUCT: stock, sellable, purchasable, Normal/Batch/Serial configuration.
- SERVICE: no stock, sellable, has pricing + tax.
- ADDITIONAL_CHARGES: no stock, usable as an invoice charge, has pricing + tax.
- The service layer normalizes stock fields (`stock_type`, `opening_qty`,
  `low_stock_alert`) away for non-PRODUCT types so no stock is ever fabricated.

## 20. Archive

- Archived products disappear from default active lists and new document
  selection, remain in the database, and remain valid for historical documents.
  Never hard-delete a product referenced by finalized documents.

## 22. Validation

- Required: Name, Item Type; Unit for PRODUCT.
- Money is non-negative. Percentage discount is within `[0, 100]`; rupee
  discount is non-negative. CESS and Low Stock Alert are non-negative. Barcode
  uniqueness is enforced (duplicate barcode rejected). All failures are surfaced
  to the user; no silent failures.

## 23. Invoice integration

- Product / Service / Additional Charges items are selectable through the
  invoice **Insert Product** picker. Archived items and non-sellable products
  are excluded. Selecting an item pre-fills name, HSN/SAC, unit, price, tax and
  (percentage) discount into a still-editable line.
- Invoice line values are captured at invoice time. Later product-master edits
  never rewrite saved/finalized invoices (DECISIONS D-010).

## 24. Purchase compatibility

- Purchase unit / price / price incl. tax / discount / tax / HSN-SAC are stored
  for future Purchase Invoice use. No stock-in is implemented.

## 21. Excel import/export — DEFERRED

- Deferred to a separate task. The party master's Excel infrastructure is
  party-specific and was not reused. The core Product Master is complete without
  it.
