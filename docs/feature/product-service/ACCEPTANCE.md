# Product / Service Master — Acceptance

## Automated (all PASS)

Quality gates on this machine:

- `pytest` — 696 passed (26 new product tests: domain, service/repository,
  groups, invoice integration, offscreen UI).
- `ruff check src tests` — all checks passed.
- `mypy --strict` — success, no issues in 146 source files (includes
  `product_service`).

Application-level tests (feature brief items 1-33) are covered by:

- `tests/unit/test_product_domain.py`
- `tests/integration/test_product_service.py`
- `tests/integration/test_product_invoice_integration.py`
- `tests/integration/test_product_ui.py`

Mapping of brief items to tests:

| Items | Covered by |
| --- | --- |
| 1-3 create Product/Service/Additional Charges | `test_create_product/service/additional_charges` |
| 4-5 edit / archive | `test_edit_product`, `test_archive_product` |
| 6-8 search name / barcode / HSN | `test_search_by_name_barcode_hsn` |
| 9-10 group create / assign | `test_group_create_and_assign` |
| 11-18 tax/CESS/No-ITC/pricing/discount/stock/low-stock persistence | `test_full_field_persistence` |
| 19-22 manufacturing / non-sellable / visibility flags | `test_manufacturing_and_visibility_flags`, `test_non_sellable_flag_persists` |
| 23-24 required-field / blank optional validation | `test_required_field_validation`, `test_blank_optionals_accepted` |
| 25-26 Service / Additional Charges no stock | `test_service_stock_normalized`, `test_additional_charges_stock_normalized`, UI `test_form_hides_stock_for_service` |
| 27-29 sellable filter / active product / service in invoice | `test_sellable_products_exclude_nonsellable_and_archived`, `test_service_and_charges_selectable` |
| 30 default population | `test_product_populates_invoice_line_defaults` |
| 31 existing invoice unchanged after edit | `test_product_edit_does_not_rewrite_saved_draft` |
| 32 archived product valid for history | `test_archived_product_remains_valid_for_history` |
| 33 survives restart | `test_product_survives_restart` |
| 19 image upload/configuration | UI `test_image_import_and_remove`, `test_image_missing_reference_does_not_break` |

Items 34-37 (Excel export/import/duplicate/invalid-row) are **not applicable**:
Excel is deferred for products (see RULES §21).

## Packaged executable

- Built with `pyinstaller packaging/invoice_generator.spec --noconfirm`.
- `dist/InvoiceGenerator/InvoiceGenerator.exe` produced (~9 MB) and launches;
  the GUI process starts and stays alive. The Products / Services screen is
  reachable from the sidebar.

## Manual acceptance (brief §27) — status

The automated + packaged-launch checks above were performed. The full
interactive manual walkthrough (create/edit each item type in the running app,
image replace/remove with real files, group add/edit through the UI, invoice
draft round-trip, finalize + PDF, and the 1366x768 / 1000x640 / 1920x1080
resize checks) requires a human operator at the machine and has **not** been
performed here. See FINAL REPORT for the honest PASS / PARTIAL breakdown.
