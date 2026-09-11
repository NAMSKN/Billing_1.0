# 🧾 Feature: Invoice Generator

> **Domain:** Core Invoicing & Document Generation  
> **Status:** Implemented (V1 Baseline)  
> **Parent System:** [Billing System Documentation](../../README.md)

---

## 📌 Overview

The **Invoice Generator** is the central feature of the Billing desktop application. It enables mould and mould-machining businesses to create, manage, finalize, print, and export professional GST-compliant tax invoices offline.

### Key Capabilities

- **Lifecycle Management:** Draft creation, item addition, editing, finalization, numbering allocation, cancellation, and duplication.
- **GST & Financial Correctness:** Automatic intra-state (CGST + SGST) and inter-state (IGST) calculation with exact integer-paise precision and round-off.
- **Machining Technical Specifications:** Structured capture of mould numbers, machining operations, dimensions, units, and rates without cramming into free-text fields.
- **Deterministic PDF Generation:** Clean, professional A4 PDF rendering built using ReportLab with exact printable margins and optional UPI payment QR code.
- **Print & Spool Pipeline:** Direct Windows printing via system spooler without external browser dependencies.
- **Historical Immutability:** Finalized invoices are cryptographically snapshotted and strictly immutable upon reprint.

---

## 📚 Feature Documentation

This folder contains all domain specifications, business rules, visual layout designs, and acceptance criteria specifically for the **Invoice Generator** feature:

| Document | Description | Key Focus Areas |
|---|---|---|
| [**`INVOICE_RULES.md`**](./INVOICE_RULES.md) | Canonical Business Rules Baseline | Financial calculations, GST boundary, numbering sequence, status lifecycle (`DRAFT` → `FINALIZED` / `CANCELLED`), immutability, data snapshotting. |
| [**`PDF_LAYOUT.md`**](./PDF_LAYOUT.md) | Professional Invoice PDF Layout Specification | A4 geometry, typographic scale, header branding, line-item table formatting, tax summary breakdown, notes, terms, bank details, and footer. |
| [**`ACCEPTANCE_E2E.md`**](./ACCEPTANCE_E2E.md) | End-to-End Acceptance Runbook | Automated headless test suite + manual printed A4 verification checklist mapping directly to `PDF_LAYOUT.md` §45. |

---

## 🔄 Core Invoice Lifecycle Workflow

```text
       ┌──────────────┐
       │ Create Draft │
       └──────┬───────┘
              │
              ▼
   ┌──────────────────────┐        Edit / Recompute
   │   Enter Line Items   │ ◄─────────────────────────┐
   │ & Customer / Details │                           │
   └──────────┬───────────┘                           │
              │                                       │
              ▼                                       │
   ┌──────────────────────┐                           │
   │  Save / Review Draft ├───────────────────────────┘
   └──────────┬───────────┘
              │
              │ Operator clicks "Finalize"
              ▼
   ┌──────────────────────────────────────────────────┐
   │                  Finalization                    │
   │ - Sequential Number Allocated (e.g. SE/26-27/001)│
   │ - Immutable Snapshot Captured                    │
   │ - Transition to FINALIZED State                  │
   └──────────┬───────────────────────────────────────┘
              │
              ├────────────────────────┬──────────────────────┐
              ▼                        ▼                      ▼
      ┌───────────────┐        ┌───────────────┐      ┌───────────────┐
      │ Generate PDF  │        │ Print Invoice │      │  Cancel / Dupl│
      │  & Save / View│        │ (Windows Spool│      │  (D-024/D-030)│
      └───────────────┘        └───────────────┘      └───────────────┘
```

---

## 🔗 Related Shared Documentation

For global architecture, cross-cutting decisions, and system requirements, consult the root documentation:

- [**System Architecture**](../../ARCHITECTURE.md) – Overall application structure, Clean Architecture layers, SQLite schema, and repository patterns.
- [**Product Requirements**](../../PRODUCT_REQUIREMENTS.md) – Application-wide product requirements baseline and scope boundaries.
- [**Architectural Decisions**](../../DECISIONS.md) – Repository-wide Architecture Decision Records (ADRs D-001 through D-032).
- [**Open Questions**](../../OPEN_QUESTIONS.md) – Open questions and safe interim policies across all modules.
- [**Installation Verification**](../../INSTALL_TEST.md) – Clean Windows environment packaging and first-run verification.
- [**Manual Smoke Test**](../../MANUAL_SMOKE_TEST.md) – Manual application smoke-test checklist.
