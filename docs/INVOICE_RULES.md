# INVOICE_RULES
## Business Rules for Local Mould / Mould-Machining Billing Application

**Document Version:** 1.0  
**Status:** Business Rules Baseline  
**Related Documents:** `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`

---

# 1. Purpose

This document defines the business rules that govern invoice creation, tax calculation, numbering, status transitions, persistence, and PDF generation.

The rules apply to a local desktop billing application for a mould / mould-machining business.

The application must produce invoices whose calculated values are deterministic and reproducible.

---

# 2. Invoice Identity

Every invoice must have:

- Unique invoice ID
- Unique invoice number
- Invoice date
- Company
- Customer
- At least one line item before finalization

Invoice number is a business identifier and must not be changed after finalization.

---

# 3. Invoice Numbering

The numbering format should support a configurable pattern such as:

```text
SE/26-27/043
SE/26-27/044
SE/26-27/045
```

Conceptual structure:

```text
PREFIX / FINANCIAL_YEAR / SEQUENCE
```

Rules:

1. Sequence is generated locally.
2. Sequence is unique within the configured numbering scope.
3. Draft numbers may be reserved according to the chosen implementation.
4. Finalized numbers must never be reused.
5. Cancelling an invoice must not free its invoice number.
6. Duplicating an invoice must create a new invoice.
7. The new invoice receives its own number when finalized.
8. Invoice-number generation must occur inside a database transaction.

Do not determine the next sequence using only `MAX(invoice_number)`.

---

# 4. Invoice Date

Rules:

- Invoice date is required.
- Default to the current local date when creating a new invoice.
- A draft may be edited.
- A finalized invoice date is immutable.
- Due date, when supplied, must not be earlier than invoice date.

Whether future-dated invoices are allowed should remain configurable as a product decision; it must not be hardcoded into the domain without confirmation.

---

# 5. Customer Rules

A customer must contain:

- Name
- Billing address
- State information

GSTIN is optional where applicable but must be validated when supplied.

A customer may have:

- Separate shipping address
- Separate consignee address
- Godown address
- Phone
- Email

Selecting an existing customer on an invoice should populate the current customer details into the draft.

However, finalized invoices must preserve their own invoice-facing customer snapshot so later customer-master edits do not change historical invoices.

---

# 6. Supplier / Company Rules

Company configuration may contain:

- Name
- Address
- GSTIN
- State
- State code
- Email
- Phone
- Logo
- Bank name
- Account number
- Branch
- IFSC
- Authorized signatory
- Signature/stamp

A finalized invoice must preserve the company details used by that invoice.

Changing company settings later must not alter historical invoice PDFs/data.

---

# 7. Bill-To and Ship-To

The invoice supports two separate party concepts:

```text
Bill To
Ship To / Consignee
```

Rules:

1. Bill-To is required.
2. Ship-To may be the same as Bill-To.
3. Ship-To may differ from Bill-To.
4. Godown information may be included when provided.
5. State details must be preserved for tax determination.

---

# 8. Invoice Reference Rules

The following values are optional unless the business specifically requires them:

- Delivery Note
- Delivery Note Date
- Reference Number
- Reference Date
- Buyer's Order / PO Number
- PO Date
- Dispatch Document Number
- Dispatch Date
- Bill of Lading / LR-RR
- Dispatched Through
- Vehicle Number
- Destination
- Terms of Delivery
- Other References

Empty optional fields should normally be omitted from the PDF rather than printed as meaningless blank labels.

---

# 9. Mould / Machining Rules

Mould/machining billing must support both structured and free-text information.

A line item may contain:

- Job / Mould reference
- Component / Part
- Operation / Process
- Description
- Specification
- HSN/SAC
- Quantity
- Unit
- Rate
- Discount
- GST

Examples from the actual invoices include:

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
2. Each operation may have a different rate.
3. Each line item calculates its own taxable amount.
4. Technical specification must not be lost when generating the PDF.
5. Free-text description remains available even when structured fields are used.
6. The application must not assume every mould job uses the same dimensions/specification.

---

# 10. Line Item Calculation

For each line item:

```text
Gross Amount = Quantity × Rate
```

Then:

```text
Discount Amount = Gross Amount × Discount %
```

Then:

```text
Taxable Amount = Gross Amount - Discount Amount
```

All monetary calculations must use exact decimal arithmetic.

Do not use binary floating-point arithmetic for invoice money.

---

# 11. Quantity Rules

Quantity:

- Is required for normal taxable line items.
- Must be greater than zero.
- May contain decimal values when the selected unit requires them.
- Must retain its entered precision where useful for display.

Examples of units found in the source invoices:

```text
MM
NOS
```

Other units may be used.

The application must not hardcode the invoice to one unit.

---

# 12. Rate Rules

Rules:

- Rate is required for a billable line item.
- Rate cannot be negative.
- Rate is monetary.
- Rate may have two decimal places in the standard display.
- Zero-rate lines should only be permitted when intentionally supported by the business rule.

---

# 13. Discount Rules

Discount is optional.

Default:

```text
0%
```

Rules:

- Discount percent must be between 0 and 100.
- Discount is applied before GST.
- Discount amount must be calculated automatically.
- The taxable value shown in the invoice must reflect the discount.

---

# 14. HSN / SAC Rules

Each taxable service line should contain an HSN/SAC code.

The sample invoices use:

```text
998898
```

as the service code shown.

Rules:

1. The value is configurable.
2. It must not be globally hardcoded as the only valid code.
3. HSN/SAC is carried through to the tax summary.
4. Multiple HSN/SAC codes may exist on one invoice.
5. Tax summary must group lines by HSN/SAC and applicable tax treatment.

---

# 15. GST Determination

Tax treatment is determined from the configured supplier/customer/place-of-supply information.

Conceptually:

```text
Supplier State
       +
Place of Supply / Customer State
       ↓
Tax Type
```

For an intra-state supply:

```text
CGST + SGST
```

For an inter-state supply:

```text
IGST
```

The sample Tally invoices demonstrate:

```text
CGST 9%
SGST 9%
```

for an 18% service charge.

The reference invoice demonstrates an IGST presentation at 18%.

Tax rates must be configurable.

---

# 16. Tax Calculation

For each line:

```text
CGST Amount = Taxable Amount × CGST Rate / 100
SGST Amount = Taxable Amount × SGST Rate / 100
IGST Amount = Taxable Amount × IGST Rate / 100
```

Only the tax components applicable to the invoice should be populated.

For example:

```text
INTRA-STATE
CGST = applicable
SGST = applicable
IGST = zero

INTER-STATE
CGST = zero
SGST = zero
IGST = applicable
```

The application must not calculate CGST + SGST + IGST simultaneously for a normal single-supply line.

---

# 17. Tax Summary Rules

The invoice tax summary must be derived from the invoice line items.

For each HSN/SAC group, calculate:

- Total taxable value
- Applicable tax rate
- CGST amount
- SGST amount
- IGST amount
- Total tax

The summary must reconcile exactly with the invoice totals.

No tax amount in the PDF should be manually typed separately from the invoice calculation engine.

---

# 18. Invoice Totals

The calculation flow is:

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

Invoice totals should expose at least:

```text
Total Taxable Amount
Total CGST
Total SGST
Total IGST
Round-Off
Grand Total
```

---

# 19. Round-Off Rule

Round-off must be an explicit calculated value.

Conceptually:

```text
Raw Total
Rounded Total
Round-Off = Rounded Total - Raw Total
```

The displayed grand total must equal:

```text
Raw Total + Round-Off
```

The round-off value may be positive or negative.

Round-off must be calculated consistently for every invoice.

---

# 20. Amount in Words

The application must generate:

- Grand total in words
- Total tax in words

The words must be generated from the final calculated decimal values, not entered manually.

Examples from the sample invoice:

```text
INR Fourteen Thousand Four Hundred Ninety Only
```

and tax amount in words.

For paise:

```text
INR ... and ... Paise Only
```

The formatting should remain consistent throughout the application.

---

# 21. Invoice Finalization

Finalization is the point at which the invoice becomes an official billing record in the application.

Before finalization:

1. Validate company data.
2. Validate customer data.
3. Validate invoice date.
4. Validate line items.
5. Validate HSN/SAC as required.
6. Validate quantity/rate/discount.
7. Determine tax treatment.
8. Calculate all totals.
9. Generate/confirm invoice number.
10. Persist invoice atomically.

After successful finalization:

- Invoice number is locked.
- Financial values are locked.
- Invoice-facing party details are preserved.
- Status becomes `FINALIZED`.

---

# 22. Finalized Invoice Immutability

A finalized invoice must not be freely editable.

The application may allow:

- View
- Preview
- Reprint
- Export again
- Mark payment status
- Cancel

It should not silently change:

- Invoice number
- Invoice date
- Customer
- Line item amounts
- Tax values
- Grand total

When a correction is required, the business workflow should use cancellation and a new invoice rather than silently rewriting history.

---

# 23. Invoice Cancellation

Cancellation should preserve the record.

When cancelled:

```text
status = CANCELLED
```

The original invoice number remains associated with the record.

The PDF/history should clearly identify the cancelled status where appropriate.

Cancellation should not delete the underlying data.

---

# 24. Invoice Duplication

Duplicate invoice means:

```text
Existing Invoice
      ↓
Copy editable business data
      ↓
Create NEW DRAFT
```

Do not copy:

- Original invoice ID
- Original finalized status
- Final invoice number

The duplicate must receive a new invoice identity/sequence according to the numbering strategy.

---

# 25. Payment Status Rules

Payment status is separate from invoice status.

Allowed values:

```text
UNPAID
PARTIAL
PAID
```

Example:

```text
Invoice Status = FINALIZED
Payment Status = UNPAID
```

A payment-status change must not change the invoice's financial calculations or invoice number.

---

# 26. Payment Details

The application may display:

- Payment terms
- Due date
- Bank details
- UPI ID
- UPI QR

The application does not process payments online.

UPI QR, if enabled, is only a payment-information/collection convenience printed on the invoice.

---

# 27. Notes and Terms

Notes are optional.

Terms & Conditions are configurable defaults with optional invoice-level customization.

Default terms must be loaded into a new draft but should become part of the invoice snapshot when finalized.

Changing default terms later must not modify historical invoices.

---

# 28. Declaration

The declaration is configurable.

When enabled, the declaration is rendered in the invoice footer.

The declaration should not be dynamically changed for historical invoices after finalization.

---

# 29. PDF Consistency Rule

There must be one authoritative calculation model.

The PDF renderer must consume calculated invoice data.

The PDF renderer must not independently recalculate:

- Tax
- Discounts
- Totals
- Round-off

This prevents differences between the application UI and printed document.

---

# 30. Reprint Rule

Reprinting a finalized invoice:

- Must not create a new invoice.
- Must not change the invoice number.
- Must not change financial values.
- Must use the stored invoice data.

If the same invoice is exported again, its content should be identical unless a purely visual/template configuration has intentionally changed.

---

# 31. Historical Data Rule

Historical invoice data must be independent of mutable master data.

For finalized invoices, preserve a snapshot of the invoice-facing values required to reproduce the document:

- Company details
- Customer details
- Bill-to address
- Ship-to address
- GSTIN
- State
- Line-item descriptions
- Mould/job information
- HSN/SAC
- Quantity
- Unit
- Rate
- Discount
- Tax rates
- Calculated taxes
- Totals
- Notes
- Terms
- Declaration

This avoids historical invoices changing because a customer master was edited.

---

# 32. Persistence Transaction Rule

Finalization must be atomic.

Conceptually:

```text
BEGIN TRANSACTION

Validate
Reserve invoice number
Persist invoice header
Persist line items
Persist totals
Persist invoice snapshots

COMMIT
```

If any required step fails:

```text
ROLLBACK
```

There must not be a partially finalized invoice.

---

# 33. Draft Save Rule

Draft saving should permit incomplete business data where practical.

A draft may lack:

- Final invoice number
- Complete line items
- Final customer details
- Some references

However, finalization must enforce all required validation rules.

---

# 34. Database Source of Truth

SQLite is the source of truth for invoice data.

PDF files are generated representations.

The application must not treat an exported PDF as the database record.

For finalized invoices:

```text
SQLite
   ↓
Canonical invoice
   ↓
PDF generation
```

---

# 35. PDF Export Rule

Export filename should be deterministic and readable.

Example:

```text
INV_SE_26-27_043.pdf
```

A custom path may be selected by the user.

Export failure must not corrupt or modify the invoice.

---

# 36. Validation Error Priority

Validation should distinguish:

### Blocking errors

Examples:

- Missing customer
- Missing line items
- Invalid quantity
- Invalid rate
- Invalid GST data
- Duplicate finalized invoice number
- Invalid tax configuration

### Non-blocking warnings

Examples:

- Missing optional PO
- Missing optional vehicle number
- Missing optional note

Warnings should not prevent normal draft editing unless a business rule explicitly requires it.

---

# 37. Source Invoice Regression Rules

The calculation engine must reproduce the following source invoice values.

## Invoice 043

```text
Taxable Value : ₹12,280.00
CGST           : ₹1,105.20
SGST           : ₹1,105.20
Round-Off      : -₹0.40
Grand Total    : ₹14,490.00
```

## Invoice 089

```text
Taxable Value : ₹8,332.00
CGST           : ₹749.88
SGST           : ₹749.88
Round-Off      : ₹0.24
Grand Total    : ₹9,832.00
```

These are mandatory regression test fixtures.

---

# 38. Data Integrity Rules

The application must enforce:

- Foreign-key integrity
- Unique invoice numbers
- Valid invoice status values
- Valid payment status values
- Valid line-item references
- Transactional invoice finalization

Database constraints should support application validation rather than relying exclusively on UI checks.

---

# 39. Delete Rules

### Draft

Draft invoices may be deleted.

### Finalized

Finalized invoices should not be hard-deleted through the normal UI.

### Cancelled

Cancelled invoices remain stored.

The goal is to prevent accidental loss of billing history.

---

# 40. Master Data Deletion Rules

Customers used by historical invoices should generally be treated as archiveable rather than destructively deleted.

If a customer is no longer active:

```text
is_active = false
```

Existing invoices remain valid.

Inactive customers should not appear by default in new invoice selection, but should remain available when viewing historical invoices.

---

# 41. Company Configuration Rule

Version 1 may support one active company.

The architecture should not require multi-company support.

If multi-company support is added later, it should be implemented deliberately rather than accidentally through a complex initial design.

---

# 42. No Online Validation Rule

GSTIN validation in Version 1 is format validation only.

No live GST verification is required.

The billing workflow must continue to work without internet.

---

# 43. Offline Rule

All business operations must work with the network disconnected:

- Create customer
- Create invoice
- Calculate GST
- Finalize invoice
- Generate PDF
- Print
- Search invoice history
- Backup
- Restore

No runtime API call may be necessary for these workflows.

---

# 44. Final Business Rule Summary

The core invariant is:

```text
A finalized invoice is a stable financial record.

Its:
- number
- date
- parties
- line items
- taxes
- totals
- terms
- declaration

must be reproducible from locally stored data.
```

The application should prefer correctness and traceability over convenience when the two conflict.
