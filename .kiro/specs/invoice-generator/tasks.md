# Implementation Plan

Tasks follow the dependency order from `ARCHITECTURE.md` §52 so business rules are designed in the domain/calculation layer before any UI. Each task is incremental, builds on prior tasks, and ends with tests where practical. Requirement references map to `requirements.md`.

- [ ] 1. Project foundation
  - Create the project structure (`src/`, `tests/`, `assets/`, `docs/`) and `pyproject.toml` with dependencies (PySide6, pydantic, reportlab, qrcode, pillow, num2words, pytest).
  - Add `.gitignore`, configure pytest, and add a platform-aware path module resolving the user data directory (`database/`, `exports/`, `backups/`, `assets/`, `logs/`).
  - Add standard Python logging writing to `logs/app.log` (no secrets/PII).
  - _Requirements: 17.1, 20.5, 23.2_

- [ ] 2. Domain enums and money utilities
  - Implement `InvoiceStatus`, `PaymentStatus`, `TaxType` enums.
  - Implement a Decimal money helper (2 dp quantize with ROUND_HALF_UP); forbid float usage in money paths.
  - Write unit tests for quantization and rounding behavior.
  - _Requirements: 7.1, 7.3, 10.1, 11.1_

- [ ] 3. Domain models
  - Implement `Company`, `Customer`, `InvoiceLine`, `Invoice`, `InvoiceTotals`, `TaxSummaryRow` as validated (pydantic) models with snapshot fields on `Invoice`.
  - Ensure bill-to and ship-to remain distinct concepts even when identical.
  - Unit-test model construction and validation.
  - _Requirements: 1, 2, 3, 5, 16.1_

- [ ] 4. Field validation rules
  - Implement format validators for GSTIN, email, and IFSC (offline/format-only).
  - Implement line-item validation (description required, HSN/SAC required for taxable, qty > 0, rate not negative, discount 0–100).
  - Implement invoice-level validation (customer required, date required, due date not before invoice date, ≥1 line to finalize) with blocking vs non-blocking classification.
  - Unit-test valid and invalid cases.
  - _Requirements: 1.5, 2.3, 3.5, 5.5, 10.2, 19.3, 20.3_

- [ ] 5. Calculation engine — line and tax math
  - Implement `CalculationService.calculate_line_amount`, `calculate_discount`, `calculate_taxable_amount`.
  - Implement tax determination (intra vs inter-state from company vs place-of-supply state code) and `calculate_cgst_sgst` / `calculate_igst` with configurable, non-hardcoded rates.
  - Ensure a single line never carries CGST/SGST and IGST simultaneously.
  - Unit-test line/tax calculations for intra- and inter-state cases.
  - _Requirements: 7.2, 8.1, 8.2, 8.3, 8.4_

- [ ] 6. Calculation engine — totals, round-off, tax summary, words
  - Implement `calculate_round_off` (round_off = rounded_total − raw_total; grand = raw + round_off) and `calculate_invoice_totals`.
  - Build the HSN/SAC-grouped tax summary that reconciles exactly with totals.
  - Implement INR amount-in-words (grand total and tax amount, with paise) wrapping num2words.
  - _Requirements: 6.3, 7.4, 7.5, 8.5, 9.1, 9.2, 9.3_

- [ ] 7. Golden invoice regression fixtures
  - Encode Invoice 043 and Invoice 089 as fixtures.
  - Assert exact taxable, CGST, SGST, round-off, and grand-total values, plus amount-in-words strings.
  - _Requirements: 21.1, 21.2, 21.3_

- [ ] 8. SQLite foundation and migrations
  - Implement `sqlite_connection` (foreign keys on, parameterized access) and a `schema_version`-based migration runner applied at startup without overwriting existing data.
  - Create schema: companies, customers, invoices (+ snapshot columns), invoice_items, invoice_sequences, app_settings; add unique invoice_number and status CHECK constraints.
  - Integration-test migration application and constraint enforcement.
  - _Requirements: 17.1, 17.2, 17.3, 17.4_

- [ ] 9. Repository interfaces and SQLite implementations
  - Define repository interfaces in `domain/repositories` (Company, Customer, Invoice, Sequence).
  - Implement SQLite repositories in `infrastructure/database`.
  - Integration-test customer and invoice persistence and draft cascade delete.
  - _Requirements: 2.7, 15.6, 17.2, 17.5_

- [ ] 10. Invoice numbering
  - Implement transactional next-sequence reservation using `invoice_sequences` (PREFIX/FY/sequence), not MAX().
  - Ensure cancel does not free a number and duplicate gets a new number at finalization.
  - Integration-test uniqueness and no reuse.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [ ] 11. Company and Customer services
  - Implement `CompanyService` (load/save single active company, format validation) and `SettingsService` (numbering config, default tax, default notes/terms, export/backup paths).
  - Implement `CustomerService` (CRUD, search, archive via is_active, auto-populate data for invoices).
  - Unit/integration-test services against repositories.
  - _Requirements: 1.1–1.5, 2.1–2.7, 6.2, 12.2_

- [ ] 12. Invoice lifecycle service
  - Implement `InvoiceService`: create/edit draft (incomplete allowed), validate, finalize atomically (reserve number → calculate → snapshot company/customer/lines/totals/notes/terms/declaration → persist → commit; rollback on failure).
  - Implement cancel (status CANCELLED, preserve record/number), duplicate (new draft, new identity), and list/search with summary-only loading.
  - Enforce finalized immutability.
  - Integration-test finalize/rollback, cancel, duplicate, and snapshot integrity (editing a master does not change a finalized invoice).
  - _Requirements: 10.1–10.7, 11.1, 11.2, 12.1–12.3, 15.1–15.6, 16.1–16.3_

- [ ] 13. PDF render DTO and renderer skeleton
  - Implement the render DTO built by `PDFService` from stored invoice data (renderer never touches the DB).
  - Set up `InvoiceRenderer` with A4 portrait, margins, a BaseDocTemplate for repeating headers and page numbers, and grayscale-safe styles.
  - _Requirements: 13.1, 13.5, 16.3_

- [ ] 14. PDF section components
  - Implement Header/Branding, InvoiceMetadata, PartyDetails (Bill/Ship), ReferenceDetails, LineItemsTable, TaxSummary, Totals, AmountWords, Payment (Bank + optional UPI QR), Notes, Terms, Declaration, Signature, Footer components in vertical order.
  - Omit empty optional fields; wrap technical text without clipping; make grand total most prominent; render QR only when configured.
  - Handle multi-page: repeat line-item header, avoid row splits, keep totals/signature together, page numbers.
  - _Requirements: 11.4, 13.2, 13.3, 13.4, 13.6, 13.7, 12.4_

- [ ] 15. PDF tests (programmatic) with golden invoices
  - Test file generation, open, A4 size, page count, required text/values, and reproduction of Invoice 043 and 089 totals in the PDF.
  - _Requirements: 13.1, 21.1, 21.2, 21.4, 21.5_

- [ ] 16. Preview, export, and printing
  - Wire preview to the same renderer output; implement export with deterministic filename (`INV_SE_26-27_043.pdf`) and user-selectable path; ensure export failure never modifies the invoice.
  - Implement `PrintService` with a replaceable OS print adapter (Windows first); reprint uses stored data and is identical.
  - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

- [ ] 17. Application composition root and shell
  - Implement `bootstrap.py` wiring SQLiteConnection → repositories → services → controllers, and `main.py` launching the PySide6 `MainWindow`.
  - Add typed application errors and a UI error boundary that converts them to business-friendly messages (no stack traces).
  - _Requirements: 20.1, 20.4, 20.6_

- [ ] 18. Customer UI
  - Implement customer list (model/view table), search, add/edit/view/duplicate, and archive, backed by `CustomerService`.
  - Field-level validation messages; no SQL/business logic in widgets.
  - _Requirements: 2.1–2.7, 20.3, 20.6_

- [ ] 19. Create/Edit Invoice UI
  - Implement the invoice form sections (Customer, Invoice details, References, Mould/job, Line items table, Taxes, Totals, Notes, Terms) with customer auto-populate.
  - Live totals via CalculationService as line items change; per-line unit selection and HSN/SAC default.
  - Actions: Save Draft, Finalize, Preview, Print, Export PDF, Cancel; keyboard shortcuts (Ctrl+N/S/P/F, Escape, Tab).
  - _Requirements: 3.1–3.6, 5.1–5.6, 6.1, 6.2, 7.6, 20.2, 20.3, 20.6, 20.7_

- [ ] 20. Invoice History UI
  - Implement history list with columns (number, date, customer, job/mould, total, invoice status, payment status).
  - Search by number/customer, date-range and status filters, sorting; actions view/preview/print/export/duplicate/cancel; summary-only loading.
  - _Requirements: 15.1–15.6_

- [ ] 21. Dashboard UI
  - Implement dashboard with New Invoice, recent invoices, quick search, and basic counts.
  - _Requirements: 20.1_

- [ ] 22. Settings UI
  - Implement Settings screens: Company, Bank, Logo, Signature/stamp, Invoice numbering, Default tax, Default notes, Default terms, Export location, Backup/restore controls.
  - Handle missing logo/signature files gracefully at render time.
  - _Requirements: 1.1–1.6, 4.1, 6.2, 8.4, 11.3, 12.2, 12.4_

- [ ] 23. Backup and restore
  - Implement `BackupService`: timestamped backups, retention of multiple versions, optional automatic backups.
  - Implement restore: validate backup, safety-backup current DB, confirm, swap, reload; never silent overwrite. Run long operations off the UI thread.
  - Integration-test backup creation and restore validation.
  - _Requirements: 18.1, 18.2, 18.3, 18.4, 20.7_

- [ ] 24. Offline verification and service templates (P2)
  - Add a test/check asserting no runtime network dependency across core workflows (create/finalize/PDF/print/search/backup/restore).
  - Optionally implement lightweight service templates (reusable descriptions) without building inventory management.
  - _Requirements: 19.1, 19.2, 22.1, 22.2, 22.3_

- [ ] 25. Packaging
  - Package as a Windows desktop executable with PyInstaller, bundling runtime + PySide6 + ReportLab + SQLite + assets.
  - Verify user data (db/backups/exports/assets/logs) lives in the user data directory, separate from the install dir, so upgrades preserve invoices.
  - _Requirements: 23.1, 23.2_

- [ ] 26. Final acceptance pass
  - Run the full test suite (unit, integration, PDF) and confirm the golden invoices pass.
  - Manually verify a printed A4 invoice (alignment, branding, line items, tax, grand total, QR, signature, B/W readability) per PDF_LAYOUT acceptance criteria.
  - Confirm draft/finalized/cancelled behavior, snapshot immutability, and offline operation end to end.
  - _Requirements: 13, 14, 16, 19, 21_
