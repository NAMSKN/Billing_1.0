# Gaps and Recommendations

Severity: High = wrong output or exploitable weakness; Medium = reliability/maintainability risk; Low = polish. Every item cites code. Items not reproduced or measured say so. Recommendations are advice only; nothing was changed.

## 0. Decision needed before any work

The documented stack (Python 3.11, PySide6, ReportLab; `docs/ARCHITECTURE.md`, workspace rules) does not match the code (Electron, React, TypeScript, PDFKit). Decide which is the product. If Electron/TS is now the target, the architecture, coding-standard and testing rules need to be rewritten for it; if Python is the target, this codebase is a prototype. Either way, rules such as "UI must not run business calculations" currently get checked against the wrong stack.

## 1. Incorrect implementations (High)

### 1.1 GSTR-1 / GSTR-3B export uses hardcoded values
- Where: `src/renderer/screens/GSTReturns.tsx` lines 114, 175-179, 189, 239, 254-255, 280, 320, 366.
- What: a literal sample GSTIN is used as the buyer `ctin` whenever the company has a GSTIN (`companyGstin ? '<literal>' : 'UNREGISTERED'`), and as the filer GSTIN fallback (`companyGstin || '<literal>'`). Missing invoice numbers become `'INV-001'`, missing place of supply becomes state `'29'`, a zero-taxable invoice gets tax rate `18`, HSN fallback is `'8480'` and quantity is `+= 1` per invoice, UQC is hardcoded `NOS`. B2B vs B2CS is decided by `place_of_supply && party_name && invoice_number` (line 114), not by the buyer's GSTIN, and `b2cs` is always emitted empty.
- Why it matters: this produces filing JSON that looks valid but carries wrong buyer identity, wrong tax rate and wrong HSN quantities. Wrong GST filings have legal and financial consequences. The product rules say tax rates must not be hardcoded and Place of Supply must be explicit.
- Recommendation: move return construction into the main process or `shared/domain/gst` (which already has `gstr1.ts`, `gstr2b.ts`, `gstr3b.ts` with tests), source buyer GSTIN, rate, HSN and quantity from the finalized invoice snapshot, block export when required data is missing instead of defaulting, and add golden tests against the two reference invoices.

### 1.2 Money summed as JavaScript numbers in the renderer
- Where: `GSTReturns.tsx:130-134,178-186` (`Number(...)` + float addition + `round2`), `ChallanEditor.tsx:720` (`String(Number(tax.cgst) + Number(tax.sgst))`).
- Why: violates "no float for money / one calculation engine" and can drift by a paisa across many invoices. Dashboard `Number()` use is chart display only and is acceptable.
- Recommendation: aggregate with `decimal.js` or integer paise in the main process and send ready totals; keep the renderer display-only.

### 1.3 Misleading comments that disagree with code
- `Modal.tsx:5` says Escape closes the modal; there is no key handler.
- `main/index.ts:140` says "Harden against a second instance"; there is no `requestSingleInstanceLock`, so two instances can open the same SQLite file.
- Recommendation: implement the behaviour (see 4.x) or fix the comments.

## 2. Security concerns

| # | Finding | Evidence | Why it matters | Recommendation |
|---|---|---|---|---|
| S1 (High) | Renderer-supplied filesystem paths are trusted | `PdfExport`/challan/order/payment export accept `savePath`; `RevealPath` accepts `path`; `BackupRestore` accepts `backupDir` (`ipc-handlers.ts:270-300,635-652`) | If the renderer is compromised (XSS via imported Excel text, a future dependency issue), it can write files to arbitrary locations or restore an arbitrary folder | Drop `savePath`/`path` parameters and always use main-process dialogs or ids; validate restore dirs against the backups directory |
| S2 (Medium) | No runtime validation of IPC payloads | About 79 `payload as X` casts in `ipc-handlers.ts`; `new Date(p.invoiceDate)` unchecked (lines 207-222, 326, 413, 534) | Malformed input becomes `Invalid Date` or `undefined` deep inside services; error text leaks to UI | Parse each payload with a schema (Zod or hand-written guards) in one helper used by `handle()` |
| S3 (Medium) | CSP differs between meta tag and header, and header delivery on `file://` is unverified | `index.html:6-9` allows `script-src 'unsafe-inline'`, `ws:`, `localhost`; `main/index.ts:25-44` strict in prod; `style-src 'unsafe-inline'` kept | If the header does not apply to `file://` pages, the effective prod CSP is the weaker meta tag | Test in a packaged build; make the meta tag the strict prod policy (inject dev relaxations only in dev) |
| S4 (Medium) | Raw error messages cross IPC | `handle()` returns `err.message` for unknown errors (`ipc-handlers.ts:1100-1104`) | May reveal file paths or SQL text | Map to stable codes and generic messages; log details in main only |
| S5 (Medium) | No sender validation and no single-instance lock | No `senderFrame` checks, 0 `requestSingleInstanceLock` | A second app instance can corrupt numbering via concurrent writers; unexpected frames can invoke handlers | Add the lock and verify `event.senderFrame.url` |
| S6 (Not verified) | Dependency vulnerabilities | `npm audit` not run; `xlsx` is a tarball URL; Electron ^34 | Parsing untrusted `.xlsx` is a known risk class | Run `npm audit`, pin the xlsx version with an integrity hash, set import size limits, track Electron support windows |
| S7 (Low) | `setWindowOpenHandler` opens any `https://` URL externally | `main/index.ts` (`setWindowOpenHandler` in `createWindow`) | Acceptable, but links are not allow-listed | Optional allow-list |

No hardcoded secrets were found by pattern scan. This is not a statement that the app is secure.

## 3. Architectural weaknesses

- Oversized components: `InvoiceEditor` (1188), `GSTReturns` (896), `ChallanEditor` (881), `OrderEditor` (876). Split into form sections, a `useDocumentEditor` hook, and presentational parts. Medium.
- Oversized registrar: `registerIpcHandlers` is about 1,000 lines in one function. Split per feature (`registerInvoiceHandlers`, ...), each in its own file. Medium.
- Duplicated History/Editor screens across Invoice, Challan, Order, Payment. Extract a `DocumentHistory` table (search, filter, status, delete, empty state) and a confirm dialog. Medium.
- No renderer data layer: every screen hand-rolls `useEffect` + `unwrap` + `useState`. Add one `useAsync`/`useQuery`-style hook (or TanStack Query) with loading, error, refetch and stale-result protection. This fixes several findings at once. High leverage.
- Preload/renderer typing: `window.api` methods take `unknown` and return `IpcResult<unknown>`; `unwrap<T>` asserts. Generate typed signatures from one channel map (request type, response type per channel) so both sides check. Medium.
- Dependency hygiene: remove unused `framer-motion`; decide where `react`, `lucide-react` live; replace tarball `xlsx` with a pinned, integrity-checked source. Small.
- Stray artefacts: `_pagecheck.ts` at repo root; HEAD still tracks `electron_billing/_pagecheck.ts` and `*.tsbuildinfo` although `*.tsbuildinfo` is in `.gitignore`. Small.

## 4. Reliability and error-handling gaps

- No `ErrorBoundary`: any render exception blanks the window. Add a top-level boundary with a recovery screen. High (cheap to fix).
- Unhandled loader failures: `InvoiceHistory.tsx:26-28`, and `Dashboard.tsx:42-52` (`try/finally`, no `catch`, then `loading=false` with `report=null` renders the skeleton indefinitely). Same pattern is likely in other History screens (0 `loading` matches in them). Medium.
- No effect cleanup / stale-response guard in any screen (0 cleanups across 49 `useEffect`). Add an ignore flag or request id. Medium.
- No global handlers in main (`uncaughtException`, `unhandledRejection`) and no local log file. Add a small file logger under the app data dir (local only, no personal data) and a diagnostic export. Medium.
- `Shell` calls `inventory.get()` on every navigation (`App.tsx` effect on `[route]`). Fetch once and on settings save. Low.
- `ToastProvider` creates a new `api` object per render and never clears timers on unmount. Wrap in `useMemo`, track timers. Low.

## 5. Performance concerns (none measured)

- No pagination: `invoices.listSummaries()` returns every invoice and filters in the renderer; each call also resolves party names per draft (`ipc-handlers.ts` summaries handler). Expect slowdown at thousands of records. Add `limit/offset/search/status` to the query and handler.
- No virtualization or paging in tables.
- `better-sqlite3` calls are synchronous in the main process; long reports, imports and exports block IPC for all windows. Measure first; move heavy work to a utility process if needed.
- All 17 screens and Recharts are statically imported (`App.tsx`). For `file://` loading the benefit is startup parse time only. Use `React.lazy` for `GSTReturns`, `Dashboard` and the editors if startup is slow.
- Inter font is configured but not shipped, so typography differs per machine. Bundle the font (WOFF2) or drop it from the stack.
- Bundle size and tree shaking are NOT VERIFIED (no build run).

## 6. Accessibility concerns

- `Modal`: no `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape handler, focus trap or focus return. Eight screens use `window.confirm` instead of the app's own dialog.
- Forms: `Label`/`Field` do not connect label to control (no `htmlFor`/`id`), errors are not linked (`aria-describedby`) or announced (`role="alert"`, `aria-invalid`). 31 `<label>` elements vs 1 `htmlFor` in the renderer.
- Navigation buttons lack `aria-current="page"`; toast container lacks `aria-live`; toast close button has no accessible name.
- Tables have `<th>` but no `scope`, no `aria-sort`, no caption.
- No `prefers-reduced-motion` handling.
- No jsx-a11y lint rules or axe tests. Contrast not computed. Recommendation: add `eslint-plugin-jsx-a11y`, fix `Modal` and `Field` once in the shared components, then add axe checks to component tests.

## 7. Testing gaps

- Strong: 31 test files, about 225 cases over calculation, money, numbering, GST helpers, validation, persistence, lifecycle, PDF, backup. Golden fixtures exist.
- Missing: any test for the renderer (about 9,000 lines), including `GSTReturns` which holds the most severe defect (1.1). `vitest.config.ts` includes only `.test.ts` in a node environment.
- Missing: E2E on the packaged app, visual regression, accessibility tests, coverage reporting or thresholds.
- Quality tooling: no Prettier, no git hooks, no jsx-a11y, no `eslint-plugin-react`, 7 `exhaustive-deps` suppressions, no Sonar.
- DX: `npm test` runs `npm rebuild better-sqlite3` first, then `dist` runs `electron-rebuild`; switching ABIs by hand is a common source of "works on my machine" failures. Consider a separate test runner setup or a prebuilt ABI cache.
- Recommendation: add `jsdom` + Testing Library for the shared components and one test per editor's critical path; Playwright (Electron) for create, finalize and PDF export.

## 8. Production readiness gaps

- No CI at all (no `.github`, no other CI file at root): lint, typecheck and tests never run automatically.
- No code signing configuration for the Windows installer; no auto-update (may be intentional for an offline product, but then a manual update path with data-migration checks should be documented).
- No crash/error logging and no diagnostics export.
- Source maps and bundle analysis not configured or verified.
- Rollback: data backup/restore exists with numbering reconciliation. App-version rollback and migration downgrade paths were not found.
- Several documents in `docs/` describe a different stack (section 0).

## 9. Not verified (need a run or a manual check)

Bundle size and tree shaking; effective CSP in a packaged build; `npm audit`; circular dependency check; colour contrast; screen-reader behaviour; behaviour of the three large editors beyond pattern counts; whether other History screens share the unhandled-loader defect; test suite pass/fail state; sort and pagination behaviour of Parties/Products tables.
