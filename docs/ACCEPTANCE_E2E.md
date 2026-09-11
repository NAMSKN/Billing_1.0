# End-to-End Acceptance (Task 62)

Full workflow acceptance on Windows: **create → finalize → PDF → print → backup
→ restore → reprint**, verifying a printed A4 page and mapping to the
`PDF_LAYOUT.md` §45 acceptance criteria (Req 19, 20, 26).

Acceptance has two levels:

- **Automated** (`tests/integration/test_end_to_end_acceptance.py`) — drives the
  entire chain headlessly through the real wired application and asserts every
  criterion that can be checked without a physical printer.
- **Manual** — one physical A4 print, which cannot be automated.

## Automated coverage

`test_end_to_end_workflow` runs the full workflow and asserts:

1. **Create + finalize** — a draft is created and finalized; number `SE/26-27/001`
   is allocated.
2. **PDF** — output starts with `%PDF-`, ends with `%%EOF`, and the MediaBox is
   A4 (595.28 × 841.89 pt).
3. **Content** — `TAX INVOICE`, invoice number, customer, and the Invoice 043
   golden aggregates are present: taxable `12,280.00`, CGST `1,105.20`, SGST
   `1,105.20`, grand total `14,490.00`.
4. **Export** — the PDF is written to disk.
5. **Print** — `PrintService` spools a valid PDF through an injected port
   (proves the render→spool→print pipeline; a real printer is not required in
   the test).
6. **Backup** — the finalized state is packaged (consistent snapshot + manifest).
7. **Restore + reconcile** — the package restores and numbering reconciles.
8. **Reprint** — after restore the same invoice (`SE/26-27/001`) re-renders with
   **identical extracted text** — no new invoice, no recalculation (D-031).

Run:

```powershell
$env:QT_QPA_PLATFORM="offscreen"
.\.venv\Scripts\python.exe -m pytest -q tests/integration/test_end_to_end_acceptance.py
```

Result: **1 passed** (verified).

The broader PDF_LAYOUT test matrix (PDF_LAYOUT §41) is covered by the existing
PDF suite: `test_pdf_regression.py` (043/089 golden values, A4, single page,
required text, reprint content equivalence), `test_pdf_long_content.py`
(wrapping / multi-page), `test_pdf_renderer.py` (A4, optional-field collapse,
special characters), and `test_pdf_payment.py` (QR omission).

## Manual acceptance — printed A4 page

Run against the packaged app (`dist/InvoiceGenerator/`, Task 60):

1. Launch `InvoiceGenerator.exe`.
2. Create a company (SUNTECH ENTERPRISES), a customer (DI-TECH MOULDS), and an
   invoice line (Gundrilling; qty 16; rate 767.50; 18%).
3. Finalize the invoice.
4. Preview the PDF, then **Print** to a physical A4 printer.
5. Inspect the printed page against the checklist below.

## Acceptance checklist (maps to PDF_LAYOUT §45)

Legend: A = asserted by the automated E2E test; P = existing PDF suite; M = manual
print inspection.

| # | PDF_LAYOUT §45 criterion | How verified |
|---|---|---|
| 1 | Looks like a professional business invoice | M |
| 2 | Preserves required billing/GST information | A (golden values), P |
| 3 | Mould/job/operation/specification readable | P (renderer), M |
| 4 | Invoice number and date immediately discoverable | A (number in text), M |
| 5 | Customer/consignee information clear | A (customer in text), M |
| 6 | Applicable GST presentation clear (CGST/SGST) | A, P |
| 7 | Grand Total highly visible | A (value present), M |
| 8 | Amount in words readable | P (`test_grand_total_words_present`) |
| 9 | Bank/payment information clearly separated | M |
| 10 | Payment status does not overpower Grand Total | M |
| 11 | Signature and declaration complete | M |
| 12 | Optional fields do not create awkward empty blocks | P (optional-field collapse) |
| 13 | Long descriptions never clip | P (`test_pdf_long_content`) |
| 14 | Multi-page invoices remain readable | P (multi-page flow) |
| 15 | Continuation pages repeat line-item headings | P |
| 16 | Footer page numbering correct | P / M |
| 17 | Black-and-white printing remains usable | M (grayscale print) |
| 18 | Special characters render correctly | P (special-characters case) |
| 19 | Missing optional assets do not break the document | P (missing logo/signature/QR) |
| 20 | Renderer never queries the database | Architecture + PdfService tests |
| 21 | Renderer does not recalculate billing values | A (reprint identical), D-031 |
| 22 | Regression fixtures reproduce aggregates exactly | A (043), P (043 + 089) |
| 23 | Suitable for normal Windows A4 printing | A (A4 size), M (physical print) |

## Manual print result

> Record the outcome of the physical print here after running the manual steps
> on a Windows machine with an A4 printer:
>
> - Date / tester:
> - Printer / paper: A4
> - Printed page attached / filed as: `______`
> - Checklist items 1, 3, 4, 5, 7, 9, 10, 11, 16, 17, 23 (manual) — pass/fail:
> - Notes:

Everything automatable is green (automated E2E + the PDF suite). The remaining
items require one physical A4 print and visual inspection using the checklist
above; the packaged app from Tasks 60–61 is the artifact to print from.
