# OPEN QUESTIONS

## Intentionally Unresolved Items — Invoice Generator

**Purpose:** These items are not yet decided. They must **not** be guessed or silently resolved in code or specs. When one is answered, record it in `DECISIONS.md` and update the affected spec.

**Convention:** Each question notes why it is open, what is blocked, and a safe interim behavior where one exists so implementation can proceed without pre-empting the decision.

---

### Q-001: Future-dated invoice policy

- **Question:** May a finalized invoice have an invoice date in the future?
- **Why open:** Business/legal preference not confirmed; affects date validation.
- **Blocks:** Finalization date validation (Requirement on invoice date).
- **Safe interim:** Allow today or past dates; treat future dates as a non-blocking warning until decided. Do not hardcode a hard block either way.

### Q-002: Invoice number display format

- **Question:** Exact human-readable format (separators, casing, spacing) of the invoice number, e.g. `SE/26-27/043` vs `SE-26-27-043`.
- **Why open:** Cosmetic/business preference; source uses `SE/26-27/043`.
- **Blocks:** Numbering formatter, PDF header.
- **Safe interim:** Use the source pattern `PREFIX/FY/NNN` with zero-padded sequence; keep the formatter configurable.

### Q-003: Initial sequence value and zero-padding width

- **Question:** What sequence does a fresh financial year start at (e.g. 1), and what zero-pad width (e.g. 3 → `043`)?
- **Why open:** Depends on the operator's existing numbering; must not clash with pre-app invoices.
- **Blocks:** Numbering configuration setup.
- **Safe interim:** Make start value and pad width configurable in numbering settings; default start 1, width 3.

### Q-004: Financial-year prefix/label format

- **Question:** How is the financial year rendered (`26-27`, `2026-27`, `FY2026-27`) and does the FY boundary follow the Indian 1 April – 31 March year?
- **Why open:** Display and rollover behavior depend on it.
- **Blocks:** FY rollover logic, numbering formatter.
- **Safe interim:** Assume Indian FY (1 Apr – 31 Mar); store FY as start/end years; render `YY-YY` by default, configurable.

### Q-005: GST rate configuration UX

- **Question:** How does the operator configure available GST rates and per-service defaults (fixed list, free entry, per-HSN mapping)?
- **Why open:** UX not confirmed; affects settings and line-item entry.
- **Blocks:** Settings UI for tax, line-item default rate.
- **Safe interim:** Configurable default rate plus per-line override; no per-HSN auto-mapping in V1.

### Q-006: Multiple companies

- **Question:** Will the product ever need more than one active company (multi-company)?
- **Why open:** Affects schema scoping of numbering and settings.
- **Blocks:** Nothing immediately; V1 assumes one active company (see DECISIONS D-001 scope).
- **Safe interim:** Model a single active company but keep a `company_id` on scoped tables so multi-company remains a deliberate future change, not a rewrite.

### Q-007: Default Terms & Conditions and Declaration wording

- **Question:** Exact default legal text for Terms & Conditions and the Declaration.
- **Why open:** Must come from the business; placeholder text could be legally wrong.
- **Blocks:** Default settings seed.
- **Safe interim:** Ship empty/placeholder defaults clearly marked "edit in Settings"; capture into the snapshot at finalization once entered.

### Q-008: Invoice template version migration strategy

- **Question:** When the visual template changes, do reprints of old invoices use the original stored template version or the newest template?
- **Why open:** Policy affects historical reproduction expectations (see DECISIONS D-020).
- **Blocks:** Reprint behavior for template version selection.
- **Safe interim:** Default to preserving the invoice's stored template version on reprint; do not auto-upgrade.

### Q-009: Restore reconciliation UX

- **Question:** Exact operator experience when a restore leaves invoice numbering behind the trusted pre-restore state (auto-advance sequence, require confirmation, manual entry?).
- **Why open:** Integrity-critical UX not confirmed. The reconciliation *mechanism* is decided (DECISIONS D-029: use the pre-restore trusted high-water state per scope); only the operator-facing UX is open.
- **Blocks:** Restore workflow UI; new-number issuance gate after restore.
- **Safe interim:** After restore, block new invoice issuance until reconciliation is explicitly confirmed; per numbering scope, advance the effective sequence to at least `trusted_high_water_mark + 1` using the pre-restore captured state. Never silently reissue numbers.

### Q-010: Cancelled invoice PDF watermark

- **Question:** Should reprinted PDFs of cancelled invoices show a "CANCELLED" watermark or banner?
- **Why open:** Presentation preference; does not affect stored data.
- **Blocks:** Cancellation reprint rendering detail only.
- **Safe interim:** Show a clear textual "CANCELLED" status label in history and on the reprint; watermark styling deferred.

### Q-011: Partial payment tracking depth

- **Question:** Does `PARTIAL` need a tracked paid amount / receipt ledger, or is it only a status marker in V1?
- **Why open:** DECISIONS D-015 excludes a ledger in V1; a status-only `PARTIAL` carries no amount.
- **Blocks:** Payment status data model depth.
- **Safe interim:** Treat `PARTIAL` as a status marker only; no amount tracked. Revisit if a ledger is requested.

### Q-012: Backdated invoice handling within numbering

- **Question:** If an invoice is backdated into a prior period, does it take a number from that period's sequence or the current sequence?
- **Why open:** Interacts with FY rollover and sequence scope.
- **Blocks:** Numbering allocation for backdated invoices.
- **Safe interim:** Allocate from the sequence of the FY implied by the invoice date; flag as an explicit case in numbering tests. Confirm before finalizing behavior.

### Q-013: Source line-level values for golden invoices

- **Question:** Exact per-line quantities/rates behind Invoice 043 and 089 aggregates.
- **Why open:** Only aggregate totals are documented; the source PDFs are not in the repo.
- **Blocks:** Complete line-level fixtures (aggregate fixtures are usable now).
- **Safe interim:** Use aggregate regression fixtures (taxable/CGST/SGST/round-off/grand total). Do not fabricate line items; label complete line-level fixtures as pending source data.

### Q-014: Automatic backup policy

- **Question:** Frequency, retention count, and trigger (on close, scheduled, on finalize) for automatic backups.
- **Why open:** Operational preference not confirmed.
- **Blocks:** Auto-backup scheduling detail (manual backup/restore is unaffected).
- **Safe interim:** Implement manual backup/restore first; make auto-backup opt-in with a configurable retention count.

### Q-015: Windows printing approach

- **Question:** Preferred Windows print/preview path (shell "print" verb, default PDF viewer open, bundled viewer, or direct spooler integration).
- **Why open:** Must be validated by the early printing spike (tasks Phase 5) before committing.
- **Blocks:** PrintService adapter implementation choice.
- **Safe interim:** Prove the simplest reliable path (open in default viewer + OS print) during the spike; choose based on evidence, not assumption.

- **Spike notes — preview/open (Task 29):**
  - **Approach chosen:** open/preview via `os.startfile(path)` on Windows, which launches the PDF in the user's associated default viewer. No extra dependency required. The opener is injectable so the code path is unit-testable without launching a GUI.
  - **Evidence:** `python -m spikes.windows_preview` was run on the target Windows machine against `spikes/out/sample_invoice.pdf`; the call returned exit code `0` with no exception, i.e. the default-viewer launch succeeded. (GUI rendering itself cannot be asserted in CI.)
  - **Status:** the **preview/open** decision is settled (use `os.startfile`). `spikes/windows_preview.py` and `spikes/windows_print.py` inform the eventual `infrastructure/printing/` adapter.

- **Spike notes — printing (Task 30):**
  - **Approach chosen:** print via the Windows shell "print" verb using `os.startfile(path, "print")`, which sends the PDF to the user's default printer through its associated application. Dependency-free and consistent with the preview approach. The print action is injectable so the code path is testable without spooling a real job.
  - **Compatibility check:** `spikes/windows_print.list_printers()` enumerates installed printers (read-only, via PowerShell `Win32_Printer`; no Python dependency added).
  - **Evidence:** on the target Windows machine the check listed 4 installed printers — `OneNote (Desktop)`, `Microsoft Print to PDF`, `HP556D54 (HP LaserJet Pro MFP 4104)`, `HP LaserJet Pro MFP M226dw (A06A92)` — and the print code path executed successfully against `spikes/out/sample_invoice.pdf`.
  - **Documented limitation / deliberate choice:** a real physical print job was **not** force-triggered in the spike run, because the shell "print" verb targets the *default* printer and some targets (e.g. "Microsoft Print to PDF") open an interactive Save-As dialog. Triggering it would risk wasting paper or blocking on a prompt. The mechanism is proven at the code-path level and the environment has working printers; a one-off manual physical print can be done during end-to-end acceptance (Task 62).
  - **Decision for the adapter:** `infrastructure/printing/` will expose a `PrintPort` with a `WindowsPrintAdapter` using `os.startfile(path, "print")`; the port keeps platform-specific code out of the business layer (design section 24). This resolves the printing half of Q-015 at the mechanism level; the only remaining nuance (whether to add printer selection UI vs. always use the default printer) is a later UX decision, not a blocker.
