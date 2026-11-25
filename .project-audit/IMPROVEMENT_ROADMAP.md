# Improvement Roadmap

Complexity: Small (under a day), Medium (a few days), Large (a week or more). Dependencies refer to task numbers. Ordering inside a priority is suggested, not required. No task has been started.

## P0: critical correctness, security, reliability

| # | Task | Reason | Expected outcome | Depends on | Complexity |
|---|---|---|---|---|---|
| P0-1 | Decide the authoritative stack (Electron/TS vs Python/PySide6) and align `docs/` and workspace rules | Rules and architecture docs describe a different application than the code | One source of truth; rules checkable against the code | none | Small (decision) / Large (if docs rewritten) |
| P0-2 | Rebuild GSTR-1/GSTR-3B export on invoice snapshot data; remove hardcoded GSTIN, `INV-001`, state `29`, rate `18`, HSN `8480`; classify B2B/B2CS by buyer GSTIN; block on missing data | Export can emit wrong buyer, rate and HSN data into filings | Exports reflect finalized invoices only, or refuse with a clear reason | P0-1 (location of code) | Medium |
| P0-3 | Add golden tests for GST return output using the two reference invoices (043, 089) | `GSTReturns.tsx` has no test coverage | Regression protection for P0-2 | P0-2 | Medium |
| P0-4 | Move money aggregation out of renderer (`Number()` sums) into main/shared Decimal code | Float sums break the exact-money rule | Totals match the calculation engine to the paisa | P0-2 | Small |
| P0-5 | Remove renderer-controlled paths from IPC (`savePath`, `RevealPath.path`, `BackupRestore.backupDir`); validate sender frame | A compromised renderer can write or restore from arbitrary locations | Main process decides every filesystem target | none | Medium |
| P0-6 | Add `requestSingleInstanceLock` | Two instances can write one SQLite file and the invoice sequence | Second launch focuses the first window | none | Small |
| P0-7 | Add a top-level `ErrorBoundary` and handle loader rejections (`InvoiceHistory`, `Dashboard`, other History screens) | A render or IPC failure leaves a blank or permanently loading screen | Visible error state with retry | none | Small |

## P1: important engineering improvements

| # | Task | Reason | Expected outcome | Depends on | Complexity |
|---|---|---|---|---|---|
| P1-1 | Schema-validate every IPC payload in `handle()` and stop returning raw error text | About 79 unchecked casts; leaks internals | Typed, validated inputs; stable error codes | none | Medium |
| P1-2 | Add CI (lint, typecheck, tests, build) | Nothing runs automatically today | Every push checked | none | Small |
| P1-3 | Create a shared async data hook (loading, error, refetch, stale-response guard, effect cleanup) and migrate screens | 49 effects without cleanup, repeated fetch code, race risk | One consistent loading/error pattern | P0-7 | Medium |
| P1-4 | Accessible `Modal`, `Field`, `Label`, nav `aria-current`, toast `aria-live`; replace `window.confirm` with a shared confirm dialog | Keyboard and screen-reader users cannot use dialogs or forms reliably | Dialogs trap and restore focus, labels linked to controls | none | Medium |
| P1-5 | Add component test setup (jsdom + Testing Library) and cover shared components plus each editor's finalize path | 0 renderer tests | Safety net for refactors | P1-2 | Medium |
| P1-6 | Typed IPC contract (one map of channel -> request/response types used by preload, handlers and `unwrap`) | `unknown` end to end | Compile-time checks across the boundary | P1-1 | Medium |
| P1-7 | Verify and fix CSP in a packaged build; make meta tag strict in production | Effective prod policy unconfirmed | Documented, tested policy | none | Small |
| P1-8 | Local file logging and global `uncaughtException`/`unhandledRejection` handlers in main | No diagnostics today | Support can read a log; no data leaves the machine | none | Small |
| P1-9 | Run `npm audit`, pin and integrity-check `xlsx`, review Electron support status, add import size limits | Dependency risk NOT VERIFIED | Known vulnerability list and a pinned dependency source | none | Small |
| P1-10 | Remove dead items: unused `framer-motion`, `_pagecheck.ts`, `tests/**` include, tracked `*.tsbuildinfo`; fix misleading comments | Debt and confusion | Clean dependency and file list | none | Small |

## P2: performance, maintainability, scalability

| # | Task | Reason | Expected outcome | Depends on | Complexity |
|---|---|---|---|---|---|
| P2-1 | Split `InvoiceEditor`, `ChallanEditor`, `OrderEditor`, `GSTReturns` and `registerIpcHandlers` | 850-1200 line units | Smaller testable modules | P1-5 | Large |
| P2-2 | Extract shared `DocumentHistory`/`DataTable` and confirm patterns | Four near-identical History screens | Less duplication | P1-3, P1-4 | Medium |
| P2-3 | Server-side pagination, search and status filters for invoices, challans, orders, vouchers | Full-list load and client filtering | Constant-cost lists | P1-6 | Medium |
| P2-4 | Fix N+1 party-name lookups in `InvoiceListSummaries` (join in repository) | One lookup per draft | Single query | P2-3 | Small |
| P2-5 | Memoize `ToastProvider` value, clear timers, fetch inventory flag once | Avoidable re-renders and calls | Fewer renders and IPC calls | none | Small |
| P2-6 | Measure first: build analyzer, React Profiler on editors, time `dashboard.report` with large data | Bundle and runtime costs not measured | Data to decide on lazy loading and worker offload | none | Small |
| P2-7 | Lazy-load heavy screens and Recharts if P2-6 shows startup cost | Static import of all screens | Faster first paint if needed | P2-6 | Small |
| P2-8 | Add Prettier, `eslint-plugin-react`, `jsx-a11y`, make `exhaustive-deps` an error and remove the 7 suppressions | Style drift, hook bugs, a11y regressions | Consistent, enforced standards | P1-2 | Medium |
| P2-9 | Add git hooks (lint-staged) | Catch issues before CI | Faster feedback | P2-8 | Small |
| P2-10 | Ship the Inter font locally or remove it from the font stack | Inconsistent typography | Predictable rendering | none | Small |

## P3: advanced and optional

| # | Task | Reason | Expected outcome | Depends on | Complexity |
|---|---|---|---|---|---|
| P3-1 | Playwright E2E for the packaged Electron app (create, finalize, PDF export, backup/restore) | Only a manual smoke-test document exists | Automated acceptance | P1-2 | Large |
| P3-2 | Accessibility test automation (axe) and `prefers-reduced-motion` support | No a11y regression protection | WCAG indicators measurable | P1-4, P1-5 | Medium |
| P3-3 | Windows code signing and a documented update/rollback path | SmartScreen warnings, no rollback story | Trusted installer, safe upgrades | none | Medium |
| P3-4 | Follow OS theme (`prefers-color-scheme`) | Minor UX | Theme default matches OS | none | Small |
| P3-5 | Virtualized tables, only if P2-6 shows large lists remain slow after paging | Optional | Smooth very large lists | P2-3, P2-6 | Medium |
| P3-6 | i18n scaffolding | Only if non-English UI is a requirement | Translatable strings | product decision | Large |
| P3-7 | Visual regression tests | Optional | Catches UI drift | P3-1 | Medium |
