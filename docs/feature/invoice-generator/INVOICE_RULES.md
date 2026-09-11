# INVOICE_RULES

## Business Rules for Local Mould / Mould-Machining Billing Application

**Document Version:** 2.0  
**Status:** Canonical Business Rules Baseline  
**Related Documents:** `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `PDF_LAYOUT.md`

---

# 1. Purpose

This document defines the business rules that govern invoice creation, validation, GST calculation, numbering, status transitions, persistence, historical integrity, payment status, and PDF generation.

The rules apply to a **Windows-first local desktop billing application** for a mould / mould-machining business.

The application must produce invoice values that are:

- deterministic
- reproducible
- locally verifiable
- auditable from stored data
- independent of mutable customer/company master data after finalization

When convenience conflicts with financial correctness or historical traceability, correctness and traceability take precedence.

---

# 2. Scope and GST Boundary

Version 1 supports normal taxable supplies under the application's configured GST model.

Supported tax modes:

- normal intra-state taxable supply: CGST + SGST
- normal inter-state taxable supply: IGST
- configurable applicable tax rates

The following are **not silently treated as ordinary 0% tax**. Unless separately approved and implemented, they are out of scope for Version 1:

- reverse charge
- exempt supply
- nil-rated supply
- zero-rated supply
- exports
- SEZ treatment
- other special GST treatments

The application must not infer a special treatment merely because a tax amount happens to be zero.

---

# 3. Invoice Identity

Every invoice record has:

- internal invoice ID
- invoice number once assigned
- invoice date
- company identity
- customer identity
- invoice status
- payment status
- at least one valid line item before finalization

The **invoice number** is the business identifier shown on the invoice.

Once finalized, the following are immutable:

- invoice number
- invoice date
- financial values
- invoice-facing party details
- invoice-facing line data
- tax treatment
- historical document snapshot

---

# 4. Invoice Lifecycle

Invoice status and payment status are separate concepts.

Invoice status:

```text
DRAFT
FINALIZED
CANCELLED
```

Payment status:

```text
UNPAID
PARTIAL
PAID
```

Typical lifecycle:

```text
DRAFT
  │
  ├── edit / save
  │
  └── finalize
        ↓
     FINALIZED
        │
        └── cancel
              ↓
          CANCELLED
```

Payment status may change after finalization without changing the invoice status or financial values.

A finalized invoice must never be silently converted back to a mutable draft.

---

# 5. Draft Validation vs Finalization Validation

Validation has two distinct levels.

## Draft validation

Draft saving should allow incomplete business data where practical.

A draft may temporarily lack:

- invoice number
- complete customer data
- complete line items
- optional references
- optional payment details
- optional notes

Draft validation should still reject malformed field values where doing so improves data quality.

## Finalization validation

Finalization is strict.

Before finalization, the application must validate all mandatory fields and business rules, calculate the invoice deterministically, obtain a valid invoice number, and persist the complete finalized record atomically.

A document must not reach `FINALIZED` with unresolved blocking errors.

---

# 6. Invoice Numbering

Invoice numbering must use a dedicated sequence mechanism.

Example:

```text
SE/26-27/043
SE/26-27/044
SE/26-27/045
```

Conceptual format:

```text
PREFIX / FINANCIAL_YEAR / SEQUENCE
```

Rules:

1. Sequence generation is local.
2. Sequence generation is transaction-safe.
3. The next number must not be derived solely from `MAX(invoice_number)`.
4. The sequence is scoped by the configured numbering scheme.
5. Finalized invoice numbers are unique.
6. A finalized number is never reused.
7. Cancelling an invoice does not free its number.
8. Reprinting an invoice does not allocate a number.
9. Duplicating an invoice creates a new draft and eventually a new finalized number.
10. Number allocation and finalized invoice persistence must be coordinated transactionally.
11. Failed finalization must not accidentally make the same finalized number available for reuse if the business has already committed that number.
12. The implementation must be safe against retries of the same finalize operation.

## Financial year

The numbering strategy must support Indian financial-year boundaries, normally:

```text
1 April → 31 March
```

The implementation must define:

- how invoice date determines the numbering financial year
- how sequences reset at the beginning of a new financial year
- behavior for backdated invoices
- behavior for future-dated invoices
- initial sequence setup from existing Tally history
- behavior when the configured prefix changes

Future-dated invoice policy remains a product decision unless explicitly configured. Do not hardcode an arbitrary restriction without approval.

## Restore safety

Restoring an older database can remove newer finalized numbers from the restored database.

Therefore:

> Restoring a backup must never automatically guarantee that the next generated number is safe to reuse.

After restore, the application must either:

- reconcile the sequence high-water mark from a trusted source, or
- place numbering into a recovery/reconciliation state until the user confirms the next safe sequence.

---

# 7. Invoice Date and Due Date

Invoice date is required.

For a new draft:

- default invoice date to the current local date
- allow editing while draft
- preserve the chosen date on finalization

After finalization:

- invoice date is immutable

Due date is optional.

When supplied:

- due date must not be earlier than invoice date unless a deliberately approved business rule permits it.

---

# 8. Company / Supplier Rules

Version 1 supports one active company.

Company configuration may contain:

- legal/business name
- address
- GSTIN
- state
- state code
- email
- phone
- logo
- bank name
- account number
- branch
- IFSC
- UPI ID
- UPI QR configuration
- authorized signatory name
- signature/stamp
- declaration
- default terms and conditions

A finalized invoice must preserve the company-facing values that were used for that invoice, including:

- company identity
- GST information
- payment details shown
- bank details shown
- UPI information shown
- declaration
- relevant visual asset references/version
- terms shown

Changing company settings later must not change historical invoice content.

---

# 9. Customer Rules

A customer must contain at least:

- name
- billing address
- state information

GSTIN is optional where applicable. If supplied, it must pass the application's configured format validation.

A customer may additionally contain:

- separate shipping address
- consignee details
- godown address
- phone
- email

Selecting a customer may populate its current master data into a draft.

That master data is only a source for the draft. It is **not** the historical source of truth after finalization.

---

# 10. Bill-To and Ship-To / Consignee

The invoice supports distinct:

```text
Bill To
Ship To / Consignee
```

Rules:

1. Bill-To is required.
2. Ship-To may equal Bill-To.
3. Ship-To may differ from Bill-To.
4. Godown information may be included when supplied.
5. State and state code relevant to tax determination must be preserved.
6. Finalized invoice snapshots must preserve both party sections as actually invoiced.

---

# 11. Place of Supply

Place of Supply must be an explicit, authoritative invoice value used for GST determination.

It must not merely be inferred from whichever customer master record happens to be current at PDF-generation time.

The finalized invoice snapshot must preserve the place-of-supply information used for the tax decision.

The invoice logic must make the tax determination traceable to:

```text
Supplier State
+
Place of Supply
+
Configured Tax Treatment
+
Applicable Rate
```

---

# 12. Invoice Reference and Logistics Fields

Optional references may include:

- delivery note
- delivery note date
- reference number
- reference date
- buyer PO number
- PO date
- dispatch document number
- dispatch date
- LR/RR / bill of lading
- vehicle number
- dispatched through
- destination
- terms of delivery
- other references

Empty optional values should normally be omitted from the PDF.

Do not render meaningless labels such as:

```text
PO No.:
Vehicle No.:
```

when there is no value.

---

# 13. Mould / Machining Line Items

Line items must support both structured and free-text technical information.

A line may contain:

- job / mould reference
- component / part
- operation / process
- description
- specification
- HSN/SAC
- quantity
- unit
- rate
- discount
- tax treatment
- applicable tax rate

Examples from the source invoices include:

```text
DT-663
PUNCH GUN DRILLING
DRILL DIA 9X307MM DEEP
QTY 16 NOS.
```

and:

```text
6 SIDE MACHINING 510X430X130
6 SIDE MACHINING 510X430X150
```

Rules:

1. One invoice may contain multiple operations.
2. Each operation may have its own rate.
3. Each line calculates its own taxable amount.
4. Technical information must survive PDF rendering without clipping or loss.
5. Structured fields do not replace free-text description capability.
6. The domain must not assume every mould job has identical dimensional data.

---

# 14. Quantity

Quantity is required for ordinary billable line items.

Rules:

- quantity must be greater than zero
- decimal quantities are allowed where the unit/business rule requires them
- entered precision should be retained where useful
- quantity must use exact decimal representation, not binary floating-point

Source examples include:

```text
MM
NOS
```

The application must not hardcode one unit.

Quantity storage must preserve enough precision for the business domain. SQLite `REAL` must not be used as the authoritative representation for exact invoice quantities.

---

# 15. Rate

A rate is required for a billable line.

Rules:

- rate cannot be negative
- rate is monetary
- monetary values must use exact decimal/integer representation
- standard display may use two decimal places
- zero rate is not automatically valid merely because it is mathematically possible

---

# 16. Discount

Discount is optional and defaults to 0%.

Rules:

- discount percentage is between 0 and 100
- discount is applied before GST
- discount amount is calculated, not manually trusted
- taxable amount reflects the discount

Formula:

```text
Gross Amount = Quantity × Rate

Discount Amount = Gross Amount × Discount %

Taxable Amount = Gross Amount - Discount Amount
```

All monetary calculation must use exact decimal arithmetic.

---

# 17. Exact Numeric Representation

Python `Decimal` is the calculation type for money.

The persistence layer must also avoid binary floating-point storage for authoritative invoice values.

Recommended Version 1 representation:

- money: integer paise
- tax/discount rates: exact fixed-scale decimal representation
- quantity: exact fixed-scale decimal representation appropriate to configured business precision

Do not store authoritative invoice money in SQLite `REAL`.

The serialization format must be deterministic so that:

- reload does not change values
- repeated calculations produce identical values
- PDF regeneration does not introduce binary-floating drift

---

# 18. HSN / SAC

Each applicable taxable line should contain an HSN/SAC code according to the business rule.

The sample invoices use:

```text
998898
```

Rules:

1. HSN/SAC is configurable.
2. It must not be globally hardcoded as the only allowed code.
3. Multiple HSN/SAC values may appear on one invoice.
4. HSN/SAC is preserved in finalized invoice snapshots.
5. HSN/SAC participates in tax-summary grouping.

---

# 19. GST Determination

For normal Version 1 taxation:

### Intra-state

```text
CGST + SGST
```

### Inter-state

```text
IGST
```

The sample Tally invoices demonstrate:

```text
CGST 9%
SGST 9%
```

for an 18% service charge.

The reference design demonstrates an IGST presentation at 18%.

Tax rates are configurable.

The implementation must not assume that 18% is the only supported rate.

---

# 20. Tax Treatment Invariants

For a normal single-supply line:

```text
INTRA-STATE
CGST > 0 where applicable
SGST > 0 where applicable
IGST = 0

INTER-STATE
CGST = 0
SGST = 0
IGST > 0 where applicable
```

The application must not calculate CGST + SGST + IGST simultaneously for a normal single-supply line.

Special GST treatments listed as out of scope must not be silently simulated through zero rates.

---

# 21. Tax Calculation

For each line:

```text
CGST Amount = Taxable Amount × CGST Rate / 100
SGST Amount = Taxable Amount × SGST Rate / 100
IGST Amount = Taxable Amount × IGST Rate / 100
```

Only applicable tax components are populated.

Tax rounding must follow one deterministic policy across the application. The selected policy must be implemented in the calculation engine rather than re-created in the PDF renderer.

---

# 22. Tax Summary Grouping

Tax summary is derived from invoice lines.

The grouping key is:

```text
HSN/SAC
+
Tax Treatment
+
Applicable Tax Rate(s)
```

HSN/SAC alone is insufficient because identical HSN/SAC values may appear with different rates or tax treatments.

For each group, calculate:

- total taxable value
- applicable rate
- CGST amount
- SGST amount
- IGST amount
- total tax

The tax summary must reconcile exactly with invoice-level tax totals.

No tax amount in the PDF may be manually typed independently from the authoritative calculation result.

---

# 23. Invoice Totals

Calculation flow:

```text
Line Items
    ↓
Gross Amount
    ↓
Discount
    ↓
Taxable Amount
    ↓
GST
    ↓
Raw Invoice Total
    ↓
Round-Off
    ↓
Grand Total
```

Invoice totals must expose at least:

- total taxable amount
- total CGST
- total SGST
- total IGST
- total tax
- round-off
- grand total

---

# 24. Round-Off

Round-off is an explicit calculated value.

Conceptually:

```text
Raw Total
    ↓
Rounded Total

Round-Off = Rounded Total - Raw Total
```

Therefore:

```text
Grand Total = Raw Total + Round-Off
```

Round-off may be positive or negative.

The rounding unit and rounding mode must be explicitly defined in the calculation engine and tested. They must not be left to database, locale, or renderer behavior.

---

# 25. Amount in Words

The application generates:

- grand total in words
- total tax in words

The words must be generated from final calculated values.

They are never manually entered as an independent financial value.

Examples:

```text
INR Fourteen Thousand Four Hundred Ninety Only
```

For paise:

```text
INR ... and ... Paise Only
```

The formatting must be consistent across all invoices.

---

# 26. Finalization Transaction

Finalization is the authoritative billing transition.

Conceptually:

```text
BEGIN TRANSACTION

Validate finalization input
Determine tax
Calculate totals
Obtain safe invoice number
Create invoice snapshot
Persist finalized invoice
Persist line items/totals
Persist required historical configuration/asset references

COMMIT
```

If any required operation fails:

```text
ROLLBACK
```

There must never be a partially finalized invoice.

Finalization must be idempotent at the service boundary: retrying an already successful finalize operation must not create a second finalized invoice.

---

# 27. Finalization Ordering

The implementation must make the sequence of decisions deterministic.

At minimum:

1. load draft
2. validate finalization requirements
3. resolve authoritative company/customer/place-of-supply data
4. determine tax treatment
5. calculate line values
6. calculate tax
7. calculate totals
8. calculate round-off
9. generate amount-in-words values
10. allocate/confirm invoice number
11. materialize the historical invoice snapshot
12. persist atomically
13. transition status to `FINALIZED`

The exact database operation order may vary, but the transaction must guarantee a coherent result.

---

# 28. Finalized Invoice Immutability

A finalized invoice may be:

- viewed
- previewed
- exported
- printed
- reprinted
- marked with payment status changes
- cancelled

A finalized invoice must not be edited in place to change:

- invoice number
- invoice date
- company-facing financial identity
- customer-facing identity
- place of supply
- line item values
- tax treatment
- tax values
- round-off
- grand total
- terms/declaration as invoiced

Corrections use a deliberate cancellation/new-invoice workflow.

---

# 29. Invoice Cancellation

Cancellation preserves the original record.

On cancellation:

```text
status = CANCELLED
```

Rules:

- original invoice number remains associated with the record
- original financial data remains stored
- cancellation timestamp is recorded
- cancellation reason is recorded
- the invoice is not hard-deleted
- the history/PDF representation may clearly indicate cancelled status

Optionally, the application may record a replacement invoice relationship, but the original identity and record remain intact.

---

# 30. Invoice Duplication

Duplicate means:

```text
Existing Invoice
      ↓
Copy editable business data
      ↓
Create NEW DRAFT
```

Do not copy:

- original invoice ID
- original finalized status
- original invoice number
- original payment status

The duplicate must be recalculated when finalized.

It receives a new invoice identity and number.

---

# 31. Payment Status

Payment status is independent from invoice status.

Allowed values:

```text
UNPAID
PARTIAL
PAID
```

Example:

```text
Invoice Status  = FINALIZED
Payment Status  = UNPAID
```

Changing payment status must not change:

- invoice number
- invoice date
- tax calculations
- round-off
- grand total

Version 1 does not claim an authoritative outstanding balance unless a receipt/payment ledger is later implemented.

---

# 32. Payment Information

The invoice may display:

- payment terms
- due date
- bank details
- UPI ID
- UPI QR

The application does not process online payments.

A UPI QR is only a payment-information/collection convenience printed on the invoice.

Payment details shown on finalized documents become part of the historical invoice snapshot.

---

# 33. Notes, Terms and Declaration

Notes are optional and may contain:

- job notes
- delivery notes
- special instructions
- inspection information

Terms and Conditions:

- are configurable defaults
- may be customized at invoice level
- become part of the finalized invoice snapshot

Declaration:

- is configurable
- may be enabled/disabled
- becomes part of the finalized invoice snapshot when rendered

Changing default notes, terms, or declaration later must not modify historical invoices.

---

# 34. Historical Invoice Snapshot

A finalized invoice must be reproducible without relying on mutable master data.

The snapshot must preserve every invoice-facing value needed to recreate the document, including at minimum:

### Company

- name
- address
- GSTIN
- state/state code
- contact details
- bank details shown
- UPI information shown
- signatory information
- logo/signature asset reference/version

### Customer / Consignee

- customer name
- billing address
- ship-to/consignee
- GSTIN
- state/state code
- relevant contact/details shown

### Invoice

- invoice number
- invoice date
- due date
- place of supply
- payment terms
- references/logistics values shown

### Lines

- job/mould
- component
- operation
- description
- specification
- HSN/SAC
- quantity
- unit
- rate
- discount
- tax treatment
- tax rate

### Calculated values

- gross amount
- discount amount
- taxable amount
- CGST
- SGST
- IGST
- total tax
- round-off
- grand total
- amount in words
- tax amount in words

### Presentation content

- notes
- terms
- declaration
- invoice template version

Master-data edits after finalization must have no effect on this snapshot.

---

# 35. Asset Versioning

Files used by historical invoices must be treated as versioned/immutable assets.

Examples:

- logo
- signature
- stamp
- QR-related configuration if embedded in the document

Do not rely only on a mutable path such as:

```text
assets/logo.png
```

because replacing the file could change a future re-render of an old invoice.

The finalized invoice should reference the asset version or persist the required immutable asset content according to the chosen architecture.

---

# 36. Invoice Template Version

Historical content immutability and PDF styling are separate concepts.

Each finalized invoice should record the invoice template/layout version used to render it.

This allows the application to distinguish:

```text
same historical invoice data
+
different visual template version
```

from an accidental change to financial/business data.

---

# 37. Reprint / Re-export

Reprinting a finalized invoice:

- does not create a new invoice
- does not allocate a new number
- does not change financial values
- reads the stored finalized invoice representation

A re-export must reproduce the same business content.

A purely visual change may be permitted only through an intentional template/versioning mechanism. It must never mutate the underlying financial record.

---

# 38. PDF Renderer Rule

There is one authoritative calculation model.

Conceptually:

```text
Stored Finalized Invoice
        ↓
Invoice Render DTO
        ↓
PDF Renderer
        ↓
A4 PDF
```

The PDF renderer:

- consumes finalized/calculated data
- does not query the database directly for random fields
- does not recalculate tax
- does not recalculate discount
- does not recalculate totals
- does not recalculate round-off

The application/domain layer prepares the complete document representation.

---

# 39. PDF Export

Export filename should be deterministic and readable.

Example:

```text
INV_SE_26-27_043.pdf
```

A custom export path may be selected.

Export failure must not modify or corrupt the finalized invoice.

The PDF is a generated representation, not the authoritative database record.

---

# 40. Validation Errors

Validation should distinguish:

## Blocking errors

Examples:

- missing company
- missing customer
- missing billing address
- missing line items
- invalid quantity
- invalid rate
- invalid discount
- missing required HSN/SAC
- invalid GST data
- invalid place of supply
- unsupported tax treatment
- duplicate finalized invoice number
- invalid numbering state
- incomplete finalization snapshot

## Non-blocking warnings

Examples:

- missing optional PO
- missing optional vehicle number
- missing optional note
- missing optional delivery reference

Warnings must not prevent draft editing unless explicitly configured as mandatory business rules.

---

# 41. Database Integrity

The database must enforce, where practical:

- foreign-key integrity
- unique finalized invoice numbers
- valid invoice statuses
- valid payment statuses
- valid line-item references
- required relationships
- transactional finalization boundaries

Application validation and database constraints must reinforce each other.

Do not rely exclusively on UI validation.

---

# 42. Delete Rules

### Draft

Draft invoices may be deleted.

### Finalized

Finalized invoices must not be hard-deleted through the normal UI.

### Cancelled

Cancelled invoices remain stored.

The purpose is to prevent accidental loss of billing history.

---

# 43. Customer Master Deletion

Customers referenced by historical invoices should normally be archived rather than destructively deleted.

Use an active/inactive concept such as:

```text
is_active = false
```

Inactive customers:

- are hidden from default new-invoice selection
- remain available for historical lookup
- do not invalidate existing finalized invoices

---

# 44. Company Configuration

Version 1 supports one active company.

The architecture should not introduce multi-company complexity merely for future-proofing.

If multi-company is added later, it must be an explicit product decision.

---

# 45. Offline Rules

All core operations must work without internet access:

- create customer
- edit customer
- create invoice
- save draft
- calculate GST
- finalize invoice
- generate PDF
- preview
- print
- search invoice history
- backup
- restore

No runtime API call is required for these workflows.

GSTIN validation in Version 1 is format validation only; live GST verification is not part of the core workflow.

---

# 46. Backup Rules

A backup must represent a recoverable application state, not merely a casual copy of a live database file.

A backup package should contain, as required:

- validated SQLite database backup
- schema/application version
- invoice-related immutable assets
- backup manifest
- integrity/check metadata

Backup creation should use a safe SQLite backup mechanism or equivalent consistency-preserving strategy.

Do not assume that copying an active SQLite file while writes are occurring is sufficient.

---

# 47. Restore Rules

Restore must be staged and validated.

Recommended flow:

```text
Select backup
   ↓
Validate package/manifest
   ↓
Validate database/schema
   ↓
Create safety backup of current state
   ↓
Restore into controlled location
   ↓
Run integrity checks
   ↓
Reconcile invoice sequence state
   ↓
Activate restored state
```

If restore fails, the current working state must remain recoverable.

A restored old backup must not silently create an invoice-number reuse risk.

---

# 48. Finalization and Sequence Safety After Restore

Before issuing a new invoice after a restore, the application must know the safe invoice-number high-water mark.

If the restored database is older than the real-world invoice history, sequence reconciliation is required.

The application must not simply execute:

```text
SELECT MAX(invoice_number)
```

and assume the result is safe.

The recovery workflow should make the risk visible and require deliberate reconciliation when needed.

---

# 49. Source Invoice Regression Fixtures

The calculation engine must reproduce the following known aggregate values.

## Invoice 043

```text
Taxable Value : ₹12,280.00
CGST          : ₹1,105.20
SGST          : ₹1,105.20
Round-Off     : -₹0.40
Grand Total   : ₹14,490.00
```

## Invoice 089

```text
Taxable Value : ₹8,332.00
CGST          : ₹749.88
SGST          : ₹749.88
Round-Off     : ₹0.24
Grand Total   : ₹9,832.00
```

These are mandatory regression fixtures.

They should be stored as machine-readable test fixtures and treated as aggregate golden cases until the complete original line-level source data is available.

---

# 50. PDF Regression Inputs

The PDF test suite must also exercise:

- Invoice 043 business content
- Invoice 089 business content
- long technical descriptions
- long customer/company names
- long addresses
- special characters including `&`, `<`, `>`
- `₹`
- `×`
- multiple line items
- missing optional logo
- missing signature
- QR enabled
- QR disabled
- one-page invoice
- multi-page invoice

A PDF test must verify both data correctness and layout safety.

---

# 51. Finalized Invoice Reproducibility

The core invariant is:

```text
A finalized invoice is a stable financial record.

Its:
- number
- date
- parties
- place of supply
- line items
- taxes
- totals
- payment information shown
- terms
- declaration
- invoice template version
- required visual assets

must be reproducible from locally stored finalized data.
```

Regenerating the PDF must not require current customer/company master data.

---

# 52. Unsupported Convenience Shortcuts

The implementation must not use shortcuts that undermine the business rules, including:

- using `MAX(invoice_number)` as the numbering algorithm
- storing money as SQLite `REAL`
- recalculating tax separately inside the PDF renderer
- mutating finalized invoices in place for corrections
- deleting cancelled invoices
- deriving historical PDFs from current mutable master data
- treating unsupported GST scenarios as generic 0% tax
- silently reusing invoice numbers after restore
- treating exported PDFs as the database source of truth
- making online connectivity a prerequisite for billing

---

# 53. Definition of Done for a Business Rule

A rule is not considered implemented merely because the UI appears to enforce it.

A business rule is complete only when, as applicable:

1. domain/application logic enforces it
2. persistence constraints support it
3. tests cover the invariant
4. PDF output reflects the same authoritative value
5. failure behavior is defined
6. historical behavior is verified where relevant

---

# 54. Final Business Rule Summary

The application should optimize for:

```text
Accounting correctness
        +
Historical traceability
        +
Deterministic calculation
        +
Offline reliability
        +
Professional document output
```

The central invariant is:

> **A finalized invoice is a stable, locally reproducible financial record.**

No mutable master record, PDF export, UI shortcut, retry, restore operation, or renderer-side calculation may silently change that record.
