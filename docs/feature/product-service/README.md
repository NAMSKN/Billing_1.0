# Product / Service Master (V2 Feature 2)

Master-data foundation for future sales/purchase invoices, quotations, proforma
invoices, purchase orders, delivery challans, inventory, and reports. This
feature establishes the product/service master and the data model required for a
future inventory engine. It does **not** implement any stock-movement / inventory
transaction system.

## Scope delivered

- Three business-facing item types: **Product**, **Service**, **Additional
  Charges**. Only a Product carries stock configuration.
- Product detail: name (required), note, barcode, HSN/SAC, unit of measurement
  (required for Product). The HSN/SAC **Find** button is a disabled future
  extension point — there is no offline lookup source.
- Tax defaults stored on the product: tax rate, CESS % / type (Fixed / Per Unit)
  / amount, No-ITC flag. The product stores defaults only; **all invoice GST
  calculation stays in the single calculation engine** (no duplication).
- Pricing (exact `Decimal`, persisted as integer paise): sell price, sell price
  incl. tax, sale discount (Rupee / Percentage), purchase price, purchase price
  incl. tax, purchase discount. Both exclusive and inclusive prices are kept as
  entered; neither is silently overwritten. The exclusive price is authoritative
  for pre-filling invoice lines.
- Manage Stock (Product only): stock type **Normal / Batch / Serial No.**,
  opening/initial quantity, and low-stock alert threshold. This is
  configuration + data model only; batch/serial transaction engines are
  deferred and clearly separated from "stock movement".
- Product groups: create / rename / archive (never hard-delete a referenced
  group). A product belongs to at most one group.
- Product images: file-dialog upload, preview, replace, remove. Images are
  stored via the shared **versioned asset store** and referenced by asset id;
  raw bytes are never stored in the product row. A missing/dangling reference
  never breaks product loading; a corrupt file produces a user-facing error.
- Flags: `is_manufactured` ("I Manufacture this product"), `is_sellable`
  (Non-Sellable toggle), `visible_on_documents`. Non-sellable and inactive are
  distinct concepts.
- List screen: tabs (All / Products / Services / Additional Charges), DB-backed
  search (name / barcode / HSN/SAC), Active/Archived and Sellable/Non-Sellable
  and Group filters, Add / Open / Edit / Archive, double-click to edit.
- Archive is safe: archived products leave history intact, are excluded from new
  document selection, and are never hard-deleted.
- Invoice integration: an **Insert Product** picker inserts an editable invoice
  line pre-filled from product defaults (name, HSN/SAC, unit, price, tax,
  percentage discount). Archived and non-sellable items are excluded. A later
  edit to the product master never rewrites an already-saved/finalized invoice.

## Deferred (explicitly out of scope for this task)

- **Excel import/export** for products is deferred to a separate task. The core
  Product Master was not weakened to add spreadsheet support quickly. The party
  master's Excel infrastructure is party-specific and was not force-fit here.
- Inventory transactions: Purchase → Stock IN, Sales → Stock OUT, batch/serial
  movement, low-stock alert generation. Only the master data / thresholds are
  persisted; future inventory logic will consume them.
- Manufacturing detail (BOM, raw-material consumption, production/work orders,
  costing). Only the `is_manufactured` flag is stored.
- Vendor-specific pricing / purchase history. A product is independent master
  data; no duplicate product records per party.

## Architecture

Layered like `vendor_customer`, dependencies pointing inward:

```
product_service/
  domain/         models.py, rules.py, repositories.py (ports)
  application/    dto.py, errors.py, product_service.py, product_group_service.py
  infrastructure/db/  mappers.py, sqlite_product_repository.py,
                      sqlite_product_group_repository.py
  ui/             product_controller.py, product_editor_dialog.py,
                  product_list_screen.py, product_group_dialog.py
```

- Schema: migration `0004_products.sql` (`products`, `product_groups`).
- Wired in `invoice_generator/bootstrap.py`; screen registered in
  `invoice_generator/ui/main_window.py` as **Products / Services**.
- Money is `Decimal` in the domain, integer paise in SQLite (DECISIONS D-004).
  UUID4 ids (D-023), canonical lowercase TEXT (D-024).
