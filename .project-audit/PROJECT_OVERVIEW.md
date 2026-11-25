# Project Overview

Audit scope: read-only inspection of `c:\Users\Namratha\Downloads\Billing`. No files outside `.project-audit/` were changed, no packages installed, no build/test/`npm audit` run.

## Method and limits

- Read in full: `package.json`, `vite.config.ts`, `vitest.config.ts`, all tsconfig files, `.eslintrc.cjs`, `tailwind.config.js`, `index.html`, `.gitignore`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/App.tsx`, `main.tsx`, `index.css`, `lib/api.ts`, `lib/theme.ts`, `components/ui.tsx`, `Modal.tsx`, `Toast.tsx`, `src/renderer/screens/InvoiceHistory.tsx` (first 150 lines).
- Partially read: `Dashboard.tsx` (first 130 lines), `GSTReturns.tsx` (lines 100-290), `useColumnPrefs.ts` (first 60 lines), `src/main/ipc-handlers.ts` (lines 1-305, 625-685 and the `handle` helper).
- Pattern-scanned only (counts, no full read): the other 14 renderer screens, `src/shared`, `src/main/app`, `db`, `pdf`. The 1,000+ line editors (`InvoiceEditor`, `ChallanEditor`, `OrderEditor`) were not read line by line. Findings about them rest on grep counts and are labelled so.
- Not run: build, tests, `npm audit`, bundle analysis, dependency-cycle tools, Lighthouse/axe, contrast calculation. Anything that needs those is marked NOT VERIFIED.

## Important mismatch: documented stack vs actual code

The workspace rules and `docs/ARCHITECTURE.md` describe a Python 3.11 + PySide6 + SQLite + ReportLab application (`docs/ARCHITECTURE.md` mentions "Language Python", "Desktop UI PySide6"). The code in the working tree is an Electron + React + TypeScript + better-sqlite3 + PDFKit application (`package.json`, `src/`). `git status` also shows `electron_billing/*` files deleted (for example `electron_billing/.eslintrc.cjs`) while the same files exist at the repo root, and `git ls-files` still lists `electron_billing/_pagecheck.ts` and `electron_billing/*.tsbuildinfo`. The repository layout appears to be mid-move (only the first lines of `git status` were inspected). Which stack is authoritative is a product decision that is not mine to make. This audit covers the code that exists (Electron/React/TS). The Python/PySide6 rules (for example "UI must not implement business calculations") are used only as a reference where the TS docs are silent.

## Technology stack

| Area | Technology (evidence) |
|---|---|
| Shell | Electron ^34 (`package.json`), main `dist-electron/main/index.js` |
| UI | React ^19, `react-dom` ^19, TypeScript ^5.7 (strict), Tailwind 3.4 + PostCSS, `lucide-react`, Recharts ^3.10 |
| Build | Vite ^6, `vite-plugin-electron`, `vite-plugin-electron-renderer`, electron-builder ^25 (NSIS x64) |
| Persistence | `better-sqlite3` ^11 in main process only; migrations in `src/main/db/migrations.ts` |
| Money | `decimal.js`; DTOs carry money as decimal strings (`src/shared/ipc.ts` header) |
| PDF | `pdfkit` (+ bundled Noto Sans fonts), `qrcode` |
| Spreadsheets | `xlsx` from a SheetJS CDN tarball URL |
| IDs | `uuid` |
| Tests | Vitest ^3 (node environment), 31 `*.test.ts` files |
| Lint | ESLint 8 legacy config, `@typescript-eslint`, `react-hooks` |
| Not present | Router library, state library, data-fetching library, Prettier, jsx-a11y, testing-library, Playwright, Zod/Yup |

## Architecture overview

```
Renderer (React, sandboxed)  --window.api (contextBridge)-->  Preload  --ipcRenderer.invoke-->  Main process
  src/renderer                  src/preload/index.ts                       src/main/ipc-handlers.ts
                                                                              |
                                                          src/main/app/*Service (use cases, unitOfWork)
                                                                              |
                                              src/shared/domain (pure calc, validation, numbering, GST)
                                                                              |
                                              src/main/db/*Repository (better-sqlite3)   src/main/pdf/*  src/main/backup/*
```

- Renderer has no Node access (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in `src/main/index.ts`).
- Preload exposes a single `window.api` object with one wrapper per IPC channel and a channel allow-list built from `IpcChannel` (`src/preload/index.ts`).
- Every handler goes through `handle()` in `ipc-handlers.ts`, which returns an `IpcResult` envelope (`ok/data` or `ok:false/error{code,message,issues}`).
- The renderer unwraps results with `unwrap()` in `src/renderer/lib/api.ts`, throwing `ApiError`.
- Composition root: `src/main/app/composition.ts` (`buildApplication`), constructor injection of repositories into services, `unitOfWork.ts` for transactions.

## Folder structure (source only)

```
src/
  main/        index.ts, ipc-handlers.ts (~1,100 lines), paths.ts
    app/       *Service.ts, *DtoMappers.ts, composition.ts, unitOfWork.ts, numberingService.ts, reconciliation*
    db/        *Repository.ts, migrations.ts, connection.ts, mappers.ts, serialization.ts
    pdf/       *Service.ts, *Renderer.ts, *RenderDto.ts, pdfLayout.ts, fonts/
    party/ product/   Excel import/export
    backup/    backupService.ts
  preload/     index.ts
  renderer/    main.tsx, App.tsx, index.css
    screens/   17 screens (Dashboard, Invoice/Challan/Order/Payment History+Editor, Parties, Products, ManageStock, GSTReturns, Settings, ...)
    components/ ui.tsx, Modal, Toast, PageHeader, ColumnChooser, CopyButton, StateSelect, UnitSelect, badges
    lib/       api.ts, format.ts, theme.ts, useColumnPrefs.ts, cn.ts
  shared/      ipc.ts, *Dto.ts, domain/ (calculation, money, numbering, validation, gst/, enums, models, repositories ports)
docs/ scripts/ samples/ build/ (icons)   Generated: dist/ dist-electron/ release/ node_modules/
```

Renderer size (lines): InvoiceEditor 1188, GSTReturns 896, ChallanEditor 881, OrderEditor 876, Settings 496, PaymentEditor 492, Products 482, PartyEditor 441, Parties 408, Dashboard 375, ManageStock 305, ProductEditor 303; all others under 250.

## Major modules and features

Sales/Purchase/Job-work invoices with draft, finalize, cancel, duplicate and payment status; delivery challans; orders (sales/purchase/service request, convert to invoice); receipt/payment vouchers with allocations; parties (customers/vendors) and products/services with Excel import/export; optional stock management; GST returns screen (GSTR-1, GSTR-2B, GSTR-3B JSON/Excel helpers); dashboard with Recharts; settings (company, tax rates, numbering, defaults); backup/restore; dark/light theme.

## Entry points

- Main: `src/main/index.ts` (`app.whenReady`, `createWindow`, CSP header, permission handler, `registerIpcHandlers`).
- Preload: `src/preload/index.ts`.
- Renderer: `index.html` -> `src/renderer/main.tsx` -> `App` (`ToastProvider` -> `Shell`).
- Scripts: `scripts/copy-assets.mjs`, `scripts/make_icon.py`.
- Stray file: `_pagecheck.ts` (a PDF page-count experiment at repo root).

## Dependency inventory (from `package.json`)

Runtime `dependencies`: better-sqlite3, decimal.js, pdfkit, qrcode, recharts, uuid, xlsx (CDN tarball).
Notable placement quirks: `react`, `react-dom`, `lucide-react`, `framer-motion` are under `devDependencies` (acceptable because Vite bundles the renderer, but inconsistent with `recharts` being under `dependencies`). `framer-motion` has zero imports in `src/`.
Dev: Electron, electron-builder, @electron/rebuild, Vite, Vitest, TypeScript, ESLint 8, Tailwind, PostCSS, Autoprefixer, type packages.

## Data flow and API integration

- There is no HTTP API. All data access is IPC. A grep of source for `fetch(`, `XMLHttpRequest`, `axios`, `WebSocket`, `EventSource` found only a comment mention (`src/main/index.ts:21`). This matches the offline-first product rule.
- Typical read: screen `useEffect` -> `unwrap(window.api.<area>.<method>())` -> preload `invoke` -> `ipcMain.handle` -> service -> repository -> DTO mapper -> JSON back.
- Typical write: editor builds a DTO, calls `window.api.*.saveDraft/finalize`, main runs a use case in a transaction; blocking issues come back as `FINALIZATION_BLOCKED` with `issues`.
- Live totals: editors call `window.api.calcPreview` (`src/main/app/calcPreview.ts`) so the UI does not compute invoice totals itself. `GSTReturns.tsx` is an exception (see GAPS).
- Persistent UI state: `localStorage` keys `theme` and `columns:<table>`.
- PDF: main process renders and opens with `shell.openPath`, or saves via `dialog.showSaveDialog`.
