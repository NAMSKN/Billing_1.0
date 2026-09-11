# 🧾 Invoice Generator

> A simple desktop billing app for **mould & mould-machining businesses**.

Create professional GST invoices, save them, print them, and export them as PDF — all from one easy-to-use desktop application.

---

## ✨ What can you do?

| | Feature |
|---|---|
| 🧾 | **Create invoices** quickly |
| 👥 | **Save customers** and reuse their details |
| 🔧 | Add **mould, job & machining details** |
| 💰 | **Automatically calculate GST & totals** |
| 📄 | Generate a **professional PDF invoice** |
| 🖨️ | **Print invoices** directly |
| 🔍 | Find old invoices with **search & filters** |
| 💾 | Keep your billing data **safe with backups** |
| 📱 | Add an optional **UPI QR code** for payment |

Everything stays on your computer.

---

## 🎯 Built for mould & machining work

This isn't just a generic billing app.

It is designed around the kind of information found in real mould and machining bills, such as:

**Job / Mould:** `DT-663`  
**Operation:** `Punch Gun Drilling`  
**Specification:** `Drill Dia 9 × 307 mm Deep`  
**Quantity:** `16 NOS.`

It can also handle jobs such as:

- 6 Side Machining
- Gundrilling
- Other machining operations
- Different dimensions and specifications
- Multiple operations on the same invoice

You can keep technical details clear without putting everything into one huge description.

---

## 🧾 Your invoice can include

### Company details
- Company name
- Address
- GSTIN
- Phone & email
- Logo
- Bank details
- Authorized signatory

### Customer details
- Bill To
- Ship To / Consignee
- GSTIN
- Billing & shipping address
- Godown address
- Contact details

### Invoice details
- Invoice number
- Invoice date
- Due date
- Payment terms
- PO number
- Challan number
- Vehicle number
- Place of supply
- Delivery information

### Mould / machining details
- Job / mould number
- Component / part
- Operation
- Description
- Specification
- HSN/SAC
- Quantity
- Unit
- Rate
- Discount

### GST & totals
- CGST
- SGST
- IGST
- Taxable amount
- Round-off
- Grand total
- Amount in words
- Tax amount in words

---

## 🎨 Professional invoice design

The invoice design takes the useful information from traditional Tally bills and combines it with a cleaner, more modern presentation.

The goal is simple:

> **Easy to read, easy to print, and professional enough to send directly to customers.**

The invoice can include:

```text
Company Branding
      ↓
Invoice & Customer Details
      ↓
Mould / Machining Work
      ↓
GST Summary
      ↓
Grand Total
      ↓
Bank / UPI Details
      ↓
Notes & Terms
      ↓
Authorized Signatory
```

---

## 💻 Completely local

This application is designed for businesses that simply want a reliable billing tool on their computer.

### No cloud required

✅ Works without internet  
✅ Data stays on your computer  
✅ No online account required  
✅ No cloud subscription  
✅ No online billing service  

You can create and print invoices even when there is no internet connection.

---

## 📂 Find everything in one place

The application will make it easy to:

**Create → Save → Search → View → Print → Export**

You can also create a new invoice from an existing one, so repeated jobs don't have to be entered from scratch.

---

## 🔐 Your billing records stay safe

The application keeps your invoices locally and supports backups.

You can:

- Create a backup
- Restore a backup
- Keep previous invoices
- Reprint old invoices
- Keep finalized invoices protected from accidental changes

---

## 🪄 Simple workflow

Creating a bill should feel like this:

```text
1. Select customer
        ↓
2. Enter mould / machining details
        ↓
3. Enter quantity & rate
        ↓
4. GST is calculated automatically
        ↓
5. Check the invoice
        ↓
6. Finalize
        ↓
7. Print or save as PDF
```

No complicated accounting workflow.

---

## 📋 Example

A typical machining invoice could look like:

| Job | Work | Specification | Qty | Unit | Rate |
|---|---|---|---:|---|---:|
| DT-663 | Punch Gun Drilling | Dia 9 × 307 mm Deep | 16 | NOS | ₹… |
| — | 6 Side Machining | 510 × 430 × 130 | 1 | NOS | ₹… |

The final invoice automatically shows the applicable GST, totals, round-off and amount in words.

---

## 🚀 Project status

**Current stage:** 🛠️ Building

The project is being developed in small stages:

- [ ] Company setup
- [ ] Customer management
- [ ] Invoice creation
- [ ] Mould / machining details
- [ ] GST calculations
- [ ] PDF invoice
- [ ] Printing
- [ ] Invoice history
- [ ] Backup & restore
- [ ] Final testing

---

## 📖 Project Documentation

The documentation is organized into **Common / Shared System Documents** (under `docs/`) and **Feature-Specific Documents** (under `docs/feature/<feature-name>/`).

### 🏛️ Common & Shared System Documents
These documents apply across the entire Billing application and cross-cutting subsystems:

| Document | Description |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Technical architecture, Clean Architecture layer design, SQLite persistence, and boundaries |
| [`PRODUCT_REQUIREMENTS.md`](./PRODUCT_REQUIREMENTS.md) | Application-wide product requirements baseline, core principles, and scope boundaries |
| [`DECISIONS.md`](./DECISIONS.md) | Authoritative Architectural Decision Records (ADRs D-001 to D-032) |
| [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) | System-wide unresolved questions and interim policies |
| [`INSTALL_TEST.md`](./INSTALL_TEST.md) | Clean-environment Windows installation and first-run verification runbook |
| [`MANUAL_SMOKE_TEST.md`](./MANUAL_SMOKE_TEST.md) | Manual application smoke-test checklist for releases |

### 🧩 Feature Documentation (`docs/feature/`)
Feature-specific rules, layouts, workflows, and acceptance runbooks are isolated within their own subdirectories:

| Feature Folder | Core Documents | Description |
|---|---|---|
| [**`feature/invoice-generator/`**](./feature/invoice-generator/README.md) | [`INVOICE_RULES.md`](./feature/invoice-generator/INVOICE_RULES.md)<br>[`PDF_LAYOUT.md`](./feature/invoice-generator/PDF_LAYOUT.md)<br>[`ACCEPTANCE_E2E.md`](./feature/invoice-generator/ACCEPTANCE_E2E.md) | Full specifications for invoice lifecycle, GST calculations, numbering, ReportLab PDF layout, and end-to-end acceptance testing. |

### 🗂️ Documentation Structure

```text
docs/
├── README.md                      # Documentation index & project overview (this file)
├── ARCHITECTURE.md                # System-wide architecture and technical design
├── PRODUCT_REQUIREMENTS.md        # Overarching product requirements & principles
├── DECISIONS.md                   # Architectural Decision Records (ADRs)
├── OPEN_QUESTIONS.md              # Cross-cutting open questions & interim policies
├── INSTALL_TEST.md                # Application installation & packaging verification
├── MANUAL_SMOKE_TEST.md           # Manual smoke-test checklist
└── feature/                       # Feature-isolated specifications
    └── invoice-generator/         # Invoice Generator feature module
        ├── README.md              # Feature overview & document index
        ├── INVOICE_RULES.md       # Canonical invoice business & calculation rules
        ├── PDF_LAYOUT.md          # Professional A4 invoice PDF layout specification
        └── ACCEPTANCE_E2E.md      # End-to-end acceptance runbook & checklist
```

---

## 💬 In one sentence

> **A simple, offline desktop billing app that helps a mould/machining business create professional GST invoices without the complexity of a full accounting system.**

---

### ⭐ Made for practical day-to-day billing

**Create the bill. Check the total. Print the invoice. Done.**
