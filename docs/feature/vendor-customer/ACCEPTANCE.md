# ACCEPTANCE

## Acceptance Criteria & Test Plan: Vendor & Customer Management

**Document Version:** 1.0  
**Status:** Baseline Verification Plan  
**Related Documents:** `README.md`, `VENDOR_CUSTOMER_RULES.md`, `UI_LAYOUT.md`

---

# 1. Functional Acceptance Matrix

| # | Acceptance Criterion | Test Verification Method | Expected Result |
|---|---|---|---|
| **AC-01** | Create valid customer with GSTIN | UI / Repository test | Party saved; State code automatically matches GSTIN prefix; PAN extracted. |
| **AC-02** | Invalid GSTIN format rejection | Validation unit test | Submitting invalid regex (e.g. 14 chars, invalid check-digit) shows immediate inline validation error. |
| **AC-03** | Create vendor with banking info | UI / Repository test | Bank name, account number, and IFSC saved cleanly; IFSC format enforced. |
| **AC-04** | Dual-role entity (`Both`) | Integration test | Party appears in both Customer autocomplete (for invoices) and Vendor list. |
| **AC-05** | Duplicate GSTIN prevention | Repository constraint test | Attempting to save a second active party with the same GSTIN raises a user-friendly duplicate conflict error. |
| **AC-06** | Soft delete / Archival | Workflow test | Deactivating a party hides it from invoice creation dropdowns; historical invoices remain untouched. |
| **AC-07** | Historical immutability test | End-to-end regression test | Editing a customer's address in the master directory does **NOT** alter previously finalized invoices (D-020). |
| **AC-08** | Offline operation | Offline execution test | All search, create, update, and archival operations execute without network access. |

---

# 2. Automated Test Coverage Blueprint

```powershell
# Targeted test suite for vendor-customer feature
.\.venv\Scripts\python.exe -m pytest -q tests/unit/domain/test_party_rules.py
.\.venv\Scripts\python.exe -m pytest -q tests/integration/test_party_repository.py
.\.venv\Scripts\python.exe -m pytest -q tests/integration/test_party_ui.py
```
