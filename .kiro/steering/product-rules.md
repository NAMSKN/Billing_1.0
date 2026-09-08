# Product Rules

Persistent product constraints. Source of truth hierarchy: Product Requirements → Invoice Rules → Architecture → PDF Layout → DECISIONS.md → OPEN_QUESTIONS.md → steering → Kiro spec. Never guess an item listed in OPEN_QUESTIONS.md.

## Scope

- Local, Windows-first desktop billing application for a mould / mould-machining business in India.
- Primary output: a professional A4 GST tax invoice PDF that can be previewed, printed, and exported.
- Invoice correctness and traceability take priority over feature breadth.

## Offline-first

- All core workflows (create customer, create/finalize invoice, calculate GST, generate PDF, preview, print, search, backup, restore) must work with no internet.
- No cloud, backend server, REST API, remote database, or online payment gateway.
- GSTIN validation is format-only; no live GST verification.

## Out of scope for V1

- ERP, CRM, inventory, payroll, manufacturing planning.
- Special GST treatments: reverse charge, exempt, nil-rated, zero-rated, export, SEZ. These must not be modeled as generic 0% (DECISIONS D-008).
- Multi-company (single active company in V1; keep company_id for future scoping only).
- Receipt/payment ledger and authoritative outstanding balances (DECISIONS D-015).

## Business invariants

- A finalized invoice is an immutable historical record: its number, dates, parties, line items, taxes, and totals cannot be edited (DECISIONS D-010).
- Finalized invoices reproduce from a stored invoice-facing snapshot, independent of later master-data edits.
- Invoice numbers are allocated from a dedicated sequence, never `MAX()` (DECISIONS D-012).
- Finalized invoice numbers are never reused. Cancellation preserves the record and its number and never releases it (DECISIONS D-016).
- Duplicating an invoice creates a NEW DRAFT; it never copies id, finalized state, final number, or payment status (DECISIONS D-017).
- Reprinting or re-exporting a finalized invoice never creates a new invoice and never changes its values.
- Payment status (UNPAID/PARTIAL/PAID) is independent of invoice lifecycle (DRAFT/FINALIZED/CANCELLED) and never changes financials or the number.

## GST behavior

- Place of Supply is an explicit, authoritative input to tax determination (DECISIONS D-009).
- Intra-state → CGST + SGST. Inter-state → IGST. Never both on one normal supply line.
- Tax rates are configurable; never hardcode 9/9 or 18.

## Draft vs finalized

- Drafts may be incomplete and freely edited/deleted.
- Finalization is strict: it validates all required business data, resolves tax, calculates totals and round-off, allocates the number safely, prepares the snapshot, and commits atomically.
