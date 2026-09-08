# Testing Rules

Persistent testing constraints. A task is Done only when its required tests exist and pass, plus lint/type checks (DECISIONS D-022). A checkbox is not evidence.

## Test types and where they apply

- **Unit tests** — calculation engine (line, discount, taxable, tax determination, tax amounts, tax grouping, totals, round-off), amount-in-words, numbering formatting, validation rules, domain models. Pure and fast.
- **Golden regression fixtures** — the two source invoices must reproduce exactly:
  - Invoice 043: taxable ₹12,280.00; CGST ₹1,105.20; SGST ₹1,105.20; round-off −₹0.40; grand total ₹14,490.00.
  - Invoice 089: taxable ₹8,332.00; CGST ₹749.88; SGST ₹749.88; round-off +₹0.24; grand total ₹9,832.00.
  - These are **aggregate** fixtures. Do not fabricate missing per-line source values; label any complete line-level fixture as pending source data (OPEN_QUESTIONS Q-013).
- **Persistence/integration tests** — repositories, constraints (unique invoice number, FK integrity, status CHECKs), migrations, draft cascade delete, exact paise round-trip (no precision loss UI→domain→DB→domain).
- **Lifecycle tests** — draft edit, strict finalization validation, atomic finalization + rollback, snapshot immutability (editing a master does not change a finalized invoice), cancellation (record + number preserved), duplication (new draft only).
- **Numbering tests** — transactional allocation, uniqueness, no reuse after finalize/cancel, FY rollover, backdated allocation case, high-water-mark behavior.
- **Restore tests** — safe backup creation, backup validation/manifest, restore with safety backup, numbering reconciliation blocking new issuance until confirmed, restore-failure recovery.
- **PDF tests** — file generated, opens, A4 size, page count, required text/values present, golden totals reproduced, optional-field omission, long-content wrapping (no clipping), special characters (& < > ₹ ×), missing logo/signature/QR degrade gracefully.
- **Windows acceptance tests** — early spike proving PDF generation, preview/open, and printing on Windows; final end-to-end acceptance on Windows.

## Rules

- Add tests for every business rule and every calculation path.
- Determinism: no test depends on wall-clock time, locale, network, or machine state; inject clocks/paths.
- No network in any test (offline is a product invariant).
- Preserve existing tests; extend rather than weaken. Do not lower coverage to make a change pass.
- Money assertions compare exact Decimal/paise values, never float-tolerant comparisons.
