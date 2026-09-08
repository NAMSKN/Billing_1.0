# PDF_LAYOUT

## Professional Invoice PDF Layout for Mould / Mould-Machining Business

**Document Version:** 2.0  
**Status:** Implementation Baseline  
**Related Documents:** `PRODUCT_REQUIREMENTS.md`, `ARCHITECTURE.md`, `INVOICE_RULES.md`

---

# 1. Purpose

This document defines the visual, structural, pagination, and rendering requirements for the generated invoice PDF.

The design is based on:

- The actual Tally invoices used for mould/machining work.
- The Tata Motors sample invoice used as a visual reference.

The goal is **not** to copy either document.

The goal is to retain the useful accounting and GST information from the Tally invoices while applying the cleaner visual hierarchy of the reference design and preserving the technical information important to a mould/machining business.

This document describes **presentation only**. It must not redefine GST rules, calculations, numbering, lifecycle, or persistence rules owned by the other project specifications.

---

# 2. Non-Negotiable Rendering Principles

The invoice must be:

- Professional and business-like.
- Clean and easy to scan.
- Printer-friendly.
- Suitable for grayscale / black-and-white printing.
- Suitable for PDF sharing.
- Legible at normal A4 print scale.
- Clear about GST and invoice identity.
- Clear about mould/job technical information.
- Stable when optional fields are absent.
- Stable when descriptions, addresses, or notes are long.
- Deterministic: the same finalized invoice snapshot and template version should render the same content.

Do not make the invoice overly decorative.

The design must communicate:

> What was billed → for whom → under which invoice → how much → how the amount was taxed.

---

# 3. Rendering Contract

The PDF renderer receives an **already finalized invoice document representation**.

Conceptually:

```text
Finalized Invoice Snapshot
        |
        v
InvoiceRenderModel / PDF DTO
        |
        v
PDF Renderer
        |
        v
A4 PDF
```

The renderer:

- MUST NOT query SQLite directly.
- MUST NOT recalculate invoice totals.
- MUST NOT determine GST treatment.
- MUST NOT allocate invoice numbers.
- MUST NOT mutate the invoice.
- MUST render exactly the values supplied by the application layer.

The render model should contain all information required to render the document, including:

- company snapshot
- customer snapshot
- consignee snapshot
- invoice metadata
- references/logistics
- line items
- tax summary
- totals
- amount in words
- payment status
- bank details
- UPI details / QR source
- notes
- terms
- declaration
- signature/stamp asset reference
- logo asset reference
- invoice template version
- page/render settings

No presentation component should reach into repository or database code.

---

# 4. Document Identity and Historical Fidelity

A finalized invoice PDF represents the finalized invoice snapshot.

Therefore, the PDF must use the historical values stored on the invoice and must not silently pull current master data.

For example, changing the company's:

- address
- GSTIN
- bank account
- logo
- signature
- UPI ID
- declaration text

must not change an already-finalized invoice's historical meaning.

Assets and visual templates may be versioned independently.

The finalized invoice should therefore carry enough information to identify:

```text
Invoice Number
Invoice Date
Invoice Template Version
Company Snapshot
Customer Snapshot
Consignee Snapshot
Bank/UPI Snapshot
Line Items
Tax Summary
Totals
Payment/Terms Snapshot
```

---

# 5. Page Format

Default:

```text
Paper: A4
Orientation: Portrait
```

Use a normal printer-safe content area.

Recommended starting margins:

```text
Top:    12–15 mm
Bottom: 12–15 mm
Left:   12–15 mm
Right:  12–15 mm
```

Exact measurements may be tuned during implementation and visual testing.

Do not depend on edge-to-edge printing.

The default design should fit ordinary invoices on one page where reasonably possible.

Invoices with many rows must flow to additional pages naturally rather than shrinking into unreadable text.

---

# 6. Page Architecture

Preferred vertical order:

```text
┌──────────────────────────────────────────────────────────┐
│ HEADER / BRANDING                                        │
├──────────────────────────────────────────────────────────┤
│ INVOICE IDENTITY / METADATA                              │
├────────────────────────────┬─────────────────────────────┤
│ BILL TO                    │ SHIP TO / CONSIGNEE         │
├────────────────────────────┴─────────────────────────────┤
│ REFERENCES / LOGISTICS                                    │
├──────────────────────────────────────────────────────────┤
│ MOULD / MACHINING LINE ITEMS                              │
├──────────────────────────────────────────────────────────┤
│ TAX SUMMARY                                               │
├──────────────────────────────────────────────────────────┤
│ TOTALS + AMOUNT IN WORDS                                  │
├────────────────────────────┬─────────────────────────────┤
│ PAYMENT / BANK DETAILS     │ PAYMENT / QR                │
├────────────────────────────┴─────────────────────────────┤
│ NOTES / TERMS                                             │
├──────────────────────────────────────────────────────────┤
│ DECLARATION / SIGNATURE                                   │
├──────────────────────────────────────────────────────────┤
│ FOOTER / PAGE NUMBER                                      │
└──────────────────────────────────────────────────────────┘
```

This is a logical structure, not a requirement that every section be a heavy bordered box.

---

# 7. Header and Branding

The header is the primary identity area.

Recommended arrangement:

### Left side

- Company logo.
- Company name.
- Address.
- GSTIN.
- State / state code.
- Phone.
- Email.

### Right side

- `TAX INVOICE`
- `ORIGINAL FOR RECIPIENT` when applicable.
- Invoice number.
- Invoice date.
- Due date when applicable.
- Place of supply when applicable.

The company name should be prominent.

`TAX INVOICE` should be immediately recognizable.

Do not allow the logo to dominate the document.

Logo requirements:

- Preserve aspect ratio.
- Do not upscale excessively.
- Do not distort.
- Support absence of logo without leaving a large empty placeholder.
- Prefer a monochrome-friendly asset where appropriate.

---

# 8. Invoice Metadata

The metadata area should make the invoice identity discoverable within seconds.

Minimum core identity:

```text
Invoice No.
Invoice Date
```

Conditional fields may include:

```text
Due Date
Place of Supply
Payment Terms
```

Only render fields that are present and applicable.

Do not produce awkward blank labels such as:

```text
Due Date:
Place of Supply:
Vehicle No:
PO No:
```

when the values are absent.

The visual layout may use a fixed grid for consistency, but unused slots must collapse cleanly.

---

# 9. Bill To and Ship To / Consignee

Use two clearly separated areas.

## Bill To

Render, when available:

- Customer name.
- Billing address.
- GSTIN.
- State.
- State code.
- Phone/email when useful.

## Ship To / Consignee

Render, when applicable:

- Consignee name.
- Shipping address.
- GSTIN where relevant.
- State.
- Godown / delivery address where applicable.

The distinction between billing party and consignee must remain clear because it is part of the source invoice structure.

When the two are identical, duplication is acceptable if required by the source/business format, but avoid visually wasteful repetition.

---

# 10. References and Logistics

Use a compact grid.

Possible fields:

```text
PO No.
PO Date
Challan No.
Challan Date
Delivery Note
Delivery Note Date
Dispatch Document No.
Vehicle No.
Dispatched Through
Destination
Terms of Delivery
Other References
```

Only populated fields should normally render.

The section must remain secondary to:

1. invoice identity
2. customer
3. line items
4. totals

Long reference values must wrap rather than clip.

---

# 11. Line-Item Design

The line-item table is the most important business-specific section.

It must prioritize **technical/job readability**, not merely generic retail-invoice appearance.

Preferred columns:

```text
#
JOB / MOULD
OPERATION
DESCRIPTION / SPECIFICATION
HSN/SAC
QTY
UNIT
RATE
DISCOUNT
AMOUNT
```

Where A4 width becomes too constrained, `JOB / MOULD` and `OPERATION` may be combined into a structured cell:

```text
DT-663
PUNCH GUN DRILLING
```

Do not combine away technical information merely to make the table narrower.

The exact column set may vary according to the invoice data and applicable business rules, but:

- quantity must remain clear
- unit must remain clear
- rate must remain clear
- amount must remain clear
- HSN/SAC must remain clear where applicable
- technical description must remain complete

---

# 12. Technical Line-Item Structure

A structured row should be capable of displaying:

```text
Job/Mould: DT-663
Operation: PUNCH GUN DRILLING
Specification: DRILL DIA 9X307MM DEEP
Qty: 16
Unit: NOS
HSN/SAC: 998898
```

A preferred visual treatment is:

```text
DT-663
PUNCH GUN DRILLING
DRILL DIA 9X307MM DEEP
```

with the numerical/commercial fields aligned independently.

Do not collapse everything into one cramped sentence when structured data is available.

---

# 13. Technical Description Rules

The PDF must preserve:

- mould/job reference
- operation
- specification
- dimensions
- quantity
- unit
- other configured technical description

Examples such as:

```text
6 SIDE MACHINING
510 × 430 × 130
```

must remain readable.

Text must wrap naturally.

Never clip a technical description.

Never replace a long description with an ellipsis in the final invoice.

---

# 14. Typography

Use a professional sans-serif font.

Suggested starting hierarchy:

```text
Company Name       15–18 pt
TAX INVOICE        15–18 pt
Section Heading    9–10 pt bold
Table Header       8–9 pt bold
Table Body         8–9 pt
Legal/Terms        7.5–8.5 pt
Footer             7–8 pt
```

These are starting values, not absolute requirements.

The final size must be validated on a real A4 page.

Do not shrink the entire document globally to make it fit.

When content is long, prefer:

1. wrapping
2. increased row height
3. natural pagination

before reducing font size.

---

# 15. Alignment

Use consistent semantic alignment.

```text
Text descriptions: left
Quantity:           right
Rate:               right
Discount:           right
Amounts:            right
HSN/SAC:            center or left
Unit:               center
Rates/percentages:  right
```

Currency values should align by decimal place as far as practical.

Do not center large amounts or descriptions merely for decoration.

---

# 16. Currency Presentation

Use one consistent INR presentation across the document.

Recommended:

```text
₹12,280.00
₹1,105.20
```

Avoid unnecessary repetition of currency symbols where the table heading already establishes the currency.

Do not allow negative round-off values to become ambiguous.

Example:

```text
Round Off       -₹0.40
```

Grand total must be explicit.

---

# 17. Tax Summary

Provide a compact tax summary after the line-item table.

Normal intra-state presentation:

```text
HSN/SAC | Taxable Value | CGST Rate | CGST | SGST Rate | SGST | Total Tax
```

Normal inter-state presentation:

```text
HSN/SAC | Taxable Value | IGST Rate | IGST | Total Tax
```

The final column set must reflect the actual finalized tax treatment.

Do not show irrelevant zero-value tax columns merely to fill space.

The summary grouping must represent the application's finalized tax summary; the renderer must not regroup or recalculate it.

The tax summary grouping key belongs to the billing rules and is not a layout decision.

---

# 18. Totals Block

The totals area must be visually prominent.

Preferred structure:

```text
Taxable Amount        ₹xx,xxx.xx
CGST                  ₹x,xxx.xx
SGST                  ₹x,xxx.xx
IGST                  ₹x,xxx.xx
Round Off             ₹xx.xx
--------------------------------
GRAND TOTAL           ₹xx,xxx.xx
```

Only applicable tax lines should be shown.

Grand Total must be:

- the strongest monetary value
- bold
- visually separated
- immediately discoverable

Do not let a payment-status badge compete visually with the Grand Total.

---

# 19. Amount in Words

Place amount in words directly below or adjacent to the totals.

Example:

```text
Amount in Words:
INR Fourteen Thousand Four Hundred Ninety Only
```

Where configured:

```text
Tax Amount in Words:
INR Two Thousand Two Hundred Ten and Forty Paise Only
```

The wording must come from the finalized calculation/render model.

Do not perform an independent amount calculation in the renderer.

Long amount-in-words text must wrap without moving or obscuring the grand total.

---

# 20. Payment and Bank Details

Payment information should be visually separated from accounting totals.

Bank details may contain:

```text
Bank Name
Account Number
Branch
IFSC
```

UPI may contain:

```text
UPI ID
UPI QR
```

QR requirements:

- Render only when configured and available.
- Preserve readability.
- Maintain a quiet margin around the code.
- Do not stretch the QR disproportionately.
- Do not render an empty QR box.

QR content must be derived from the finalized configured payment data.

---

# 21. Payment Status

Supported visual status:

```text
UNPAID
PARTIALLY PAID
PAID
```

Payment status should be subtle.

Recommended placement:

- payment section
- metadata area
- or a small badge adjacent to payment information

It must never resemble the Grand Total.

A status badge does not by itself imply a reliable historical amount-paid balance unless the application's payment model supports that.

---

# 22. Notes

Notes may contain:

- job notes
- delivery notes
- special instructions
- inspection information

Use a compact block.

Example:

```text
Notes
Additional machining completed as instructed.
```

Notes should grow with content but should not consume excessive space when empty or short.

Do not reserve a large blank notes box by default.

---

# 23. Terms and Conditions

Place Terms & Conditions toward the lower portion of the invoice.

Use:

- smaller but readable type
- numbered lines where appropriate
- consistent spacing

Do not allow legal text to overpower:

- invoice identity
- line items
- tax
- grand total

Terms are configuration/business content and should not be hard-coded into rendering logic.

---

# 24. Declaration

Provide a compact declaration area near the bottom.

Example concept:

```text
Declaration:
We declare that this invoice shows the actual price of the
goods/services described and that all particulars are true
and correct.
```

The exact declaration text must come from configured business settings or the finalized invoice snapshot.

Do not hard-code a legal declaration into the PDF renderer.

---

# 25. Signature / Authorization

Recommended structure:

```text
For SUNTECH ENTERPRISES

[Signature / Stamp]

Authorized Signatory
```

Signature/stamp image requirements:

- Preserve aspect ratio.
- Do not upscale excessively.
- Keep enough whitespace around the image.
- Do not let it overlap declaration or footer.
- Support invoices where no image is configured.

Historical finalized invoices should reference the versioned asset needed to reproduce their appearance.

---

# 26. Footer

Footer may contain:

```text
This is a Computer Generated Invoice
Page 1 of 1
```

For multi-page output:

```text
Page 1 of 3
Page 2 of 3
Page 3 of 3
```

Page numbering must be generated automatically.

Footer should be visually quiet.

---

# 27. Borders and Separators

Use borders selectively.

Recommended:

- clear outer document boundary or structure
- clear section separators
- useful table borders
- light internal rules
- stronger distinction around Grand Total

Avoid making every field look like a boxed form.

The source Tally documents are denser. The improved layout should retain their structure while reducing unnecessary visual noise.

---

# 28. Color

The invoice must remain fully understandable in grayscale.

Color may be used only for subtle hierarchy, such as:

- header accent
- section heading
- Grand Total highlight
- payment status

Do not rely on color alone to communicate:

- paid/unpaid state
- taxable vs tax information
- required invoice identity
- errors or warnings

A black-and-white print must preserve the same information hierarchy.

---

# 29. Whitespace

Whitespace should separate logical sections.

The layout must not:

- cram every field together
- fill every blank area
- push totals into an awkward position
- create very large empty blocks when optional fields are absent

At the same time, excessive whitespace must not force ordinary invoices onto a second page unnecessarily.

Use vertical space deliberately around:

- header
- party information
- line-item table
- totals
- signature

---

# 30. Optional Field Collapse Rules

Optional sections collapse when there is no content.

Examples:

```text
No PO data        → no PO row
No vehicle        → no vehicle row
No due date       → no due-date field
No UPI            → no QR/payment box
No signature      → no blank signature image area
No notes          → no large notes area
```

Do not render empty labels simply because the source format has the field.

Conditional content must not produce broken borders, excessive whitespace, or orphan headings.

---

# 31. Page Break Rules

When an invoice exceeds one page:

1. Repeat the line-item header on every line-item continuation page.
2. Continue rows naturally.
3. Avoid splitting a row across pages when the PDF engine can prevent it reasonably.
4. Do not split technical content in a way that loses context.
5. Keep the tax summary together where practical.
6. Keep Grand Total intact.
7. Keep declaration and signature on the final page.
8. Show page numbering on every page.
9. Do not place a section heading at the bottom of a page without enough content below it.
10. Never resolve overflow by making the PDF unreadably small.

If the implementation cannot keep the signature/declaration together on the final page, it must at minimum ensure both remain complete and ordered correctly.

---

# 32. Long Technical Descriptions and Long Content

The renderer must handle:

- long mould/job descriptions
- long operation names
- long specifications
- long customer names
- long addresses
- long PO/reference values
- long notes
- long terms
- unusual characters
- multiple line items

Rules:

- wrap text
- increase row/section height
- preserve all content
- keep semantic grouping
- never clip silently
- never replace final content with `...`

For a technical row, stacked content is acceptable:

```text
Operation
Specification
Additional Description
```

within one cell.

---

# 33. Special Characters and Typography Safety

The renderer must correctly handle at least:

```text
₹
×
&
<
>
-
/
()
.
,
```

Examples:

```text
510 × 430 × 130
R&D machining
<special instruction>
```

The PDF must preserve text as selectable text where the chosen rendering method permits it.

Do not rely on unsupported font glyphs.

The selected font must contain the required characters, especially INR `₹` and multiplication `×`.

---

# 34. Invoice 043 Visual Regression

The layout must be able to represent the following source information clearly:

```text
Customer:
DI-TECH MOULDS

Service:
Service Charges @18% (Gundrilling)

Job:
DT-663

Operation:
PUNCH GUN DRILLING

Specification:
DRILL DIA 9X307MM DEEP

Quantity:
16 NOS.

HSN/SAC:
998898

Taxable:
₹12,280.00

CGST:
₹1,105.20

SGST:
₹1,105.20

Round Off:
-₹0.40

Grand Total:
₹14,490.00
```

The aggregate values are regression targets. The renderer must display the finalized values supplied by the calculation/lifecycle layer.

---

# 35. Invoice 089 Visual Regression

The layout must be able to represent:

```text
Customer:
BMSS STEEL INDUSTRIES PRIVATE LIMITED

PO:
BMSS/L/070/26-27

Challan:
CHALLAN NO. 353

Vehicle:
MH48CQ5748

Payment Terms:
30 Days

Line 1:
6 SIDE MACHINING 510X430X130

Line 2:
6 SIDE MACHINING 510X430X150

HSN/SAC:
998898

Taxable:
₹8,332.00

CGST:
₹749.88

SGST:
₹749.88

Round Off:
₹0.24

Grand Total:
₹9,832.00
```

As with Invoice 043, these values should be treated as regression targets for the finalized document representation.

---

# 36. Reference Image Influence

The Tata reference design may influence:

- stronger visual hierarchy
- cleaner metadata
- prominent total
- clearer customer section
- cleaner payment section
- QR placement
- notes
- terms
- signature treatment

It must **not** introduce unrelated:

- Tata branding
- automotive-specific content
- labels that have no meaning for this business

The reference is a visual influence, not a source of billing rules.

---

# 37. Tally Influence

The Tally source invoices influence the PDF's information architecture, especially:

- GST information
- HSN/SAC
- tax summary
- declaration
- bank details
- invoice references
- consignee/buyer distinction
- mould/machining technical information
- amount in words
- computer-generated invoice footer

The improved PDF should not become a visual copy of Tally.

---

# 38. Renderer Component Structure

Recommended focused components:

```text
InvoiceRenderer
├── HeaderRenderer
├── MetadataRenderer
├── PartyDetailsRenderer
├── ReferenceDetailsRenderer
├── LineItemsRenderer
├── TaxSummaryRenderer
├── TotalsRenderer
├── AmountWordsRenderer
├── PaymentRenderer
├── NotesRenderer
├── TermsRenderer
├── DeclarationRenderer
├── SignatureRenderer
└── FooterRenderer
```

Components should own presentation only.

Shared formatting helpers may handle:

- money formatting
- date formatting
- text wrapping
- conditional field rendering
- page numbering
- asset loading

Business calculation logic must stay outside these components.

---

# 39. ReportLab / Layout-Specific Guidance

The implementation is expected to use ReportLab.

Prefer layout primitives that support natural flow and pagination, such as:

- `BaseDocTemplate`
- `PageTemplate`
- `Frame`
- `Paragraph`
- `Table`
- `TableStyle`
- `KeepTogether`
- `PageBreak`
- `KeepInFrame` where appropriate

Avoid a giant canvas routine with manually hard-coded `y` coordinates for every field.

Absolute positioning is acceptable for small stable elements such as:

- a fixed logo area
- signature image area
- page footer elements

but the main invoice body should use flowable layout so long content and multi-page invoices remain robust.

---

# 40. PDF Quality and Integrity Checks

Every generated PDF must be checked for:

### Content correctness

- invoice number
- invoice date
- customer
- consignee
- line-item values
- HSN/SAC
- taxable value
- tax amounts/rates as applicable
- round-off
- grand total
- amount in words

### Layout correctness

- no clipped text
- no overlap
- no broken borders
- no orphaned headings
- correct page count
- repeated line-item header on continuation pages
- complete final-page signature/declaration

### Asset correctness

- correct logo
- correct signature/stamp
- correct QR when enabled
- no missing-image artifacts

### Print correctness

- A4
- safe margins
- grayscale-readable
- normal print scale

---

# 41. PDF Test Matrix

The renderer must be tested with at least these cases:

| Case | Expected result |
|---|---|
| Normal single-page invoice | Clean A4 output |
| Invoice 043 regression | Exact displayed aggregate values |
| Invoice 089 regression | Exact displayed aggregate values |
| Long technical description | Wraps; no clipping |
| Long customer name | Wraps; no overlap |
| Long address | Wraps; no overflow |
| Many line items | Multi-page flow |
| Missing optional fields | Sections collapse cleanly |
| Missing logo | No broken-image placeholder |
| Missing signature | No broken-image placeholder |
| QR disabled | No empty QR box |
| Special characters | Render correctly |
| Grayscale print | Information remains understandable |
| Large amount | Currency alignment remains usable |
| Negative round-off | Sign is obvious |
| Inter-state tax presentation | IGST layout shown correctly |
| Intra-state tax presentation | CGST/SGST layout shown correctly |

---

# 42. Visual Regression Strategy

PDF correctness should not rely only on opening the file manually.

Use two levels of testing:

## Level 1 — Structural/content assertions

Verify:

- PDF generated successfully.
- expected page count.
- expected text present.
- expected invoice number present.
- expected grand total present.
- expected technical description present.

## Level 2 — Visual regression

For approved fixtures:

1. Render the PDF page to an image.
2. Compare with the approved baseline using a controlled tolerance.
3. Review meaningful layout differences instead of requiring pixel-perfect identity across different renderers/environments.

Approved fixture PDFs/images should be versioned with the codebase.

---

# 43. Font and Asset Requirements

Fonts and assets used by the renderer must be explicit and reproducible.

The application should not depend on an arbitrary font installed on the user's machine.

At minimum:

- specify the selected font family
- package required font files with the application when licensing permits
- verify INR and technical symbols
- version logo/signature assets
- handle missing optional assets gracefully

Do not silently substitute a font that changes layout enough to cause clipping.

---

# 44. Template Versioning

The invoice should carry a template version such as:

```text
invoice_template_version = "1.0"
```

A future visual redesign can then produce:

```text
1.1
2.0
```

without changing the historical business data of an existing finalized invoice.

Template versioning is for visual/document reproducibility.

It must not be used as a substitute for invoice calculation or GST versioning.

---

# 45. Final Acceptance Criteria

The PDF layout is accepted only when:

1. It looks like a professional business invoice.
2. It preserves all required billing/GST information from the finalized invoice.
3. Mould/job/operation/specification information is easy to understand.
4. Invoice number and date are immediately discoverable.
5. Customer/consignee information is clear.
6. Applicable GST presentation is clear.
7. Grand Total is highly visible.
8. Amount in words is readable.
9. Bank/payment information is clearly separated.
10. Payment status does not overpower the Grand Total.
11. Signature and declaration are complete.
12. Optional fields do not create awkward empty blocks.
13. Long descriptions never clip.
14. Multi-page invoices remain readable.
15. Continuation pages repeat line-item headings.
16. Footer page numbering is correct.
17. Black-and-white printing remains usable.
18. Special characters render correctly.
19. Missing optional assets do not break the document.
20. The renderer never queries the database directly.
21. The renderer does not independently recalculate billing values.
22. Regression fixtures reproduce the approved aggregate values exactly.
23. The PDF is suitable for normal Windows printing on A4 paper.

---

# 46. Visual Priority

Use this priority:

```text
1. Company + TAX INVOICE
2. Invoice Number / Date
3. Customer
4. Mould / Job / Operation / Specification
5. Line-item amounts
6. GRAND TOTAL
7. GST summary
8. Payment details
9. Notes / Terms
10. Legal / Footer
```

The invoice should communicate the core transaction before secondary information.

---

# 47. Final Design Principle

The finished invoice should feel like:

```text
Tally accounting accuracy
        +
Modern business-invoice clarity
        +
Mould/machining technical readability
        +
Reliable A4 printing
```

It should **not** feel like:

```text
A Tally screenshot
        or
A generic retail invoice
        or
An over-designed marketing document
        or
A fragile one-page layout that breaks with real data
```

The most important quality criterion is not visual decoration.

It is:

> **A professional invoice that remains correct, readable, printable, and reproducible when real mould/machining data is used.**
