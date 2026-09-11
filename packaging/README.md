# Windows Packaging (Task 60)

Builds the Invoice Generator as a Windows-first, self-contained desktop
application using PyInstaller, bundling the Python runtime, third-party
dependencies, and the app's packaged data files. User data stays outside the
install directory so upgrades never destroy invoices (DECISIONS D-013; Req 27).

## Prerequisites

Install the packaging toolchain into the project virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -e ".[packaging]"
# or, directly:
.\.venv\Scripts\python.exe -m pip install "pyinstaller>=6.6"
```

## Build

From the project root:

```powershell
.\.venv\Scripts\python.exe -m PyInstaller packaging/invoice_generator.spec --noconfirm
```

Output (one-folder distribution):

```
dist/InvoiceGenerator/
  InvoiceGenerator.exe        <- launch this
  _internal/                  <- bundled runtime, deps, and data
    invoice_generator/infrastructure/db/migrations/*.sql
    PySide6/ ...
```

Ship the entire `dist/InvoiceGenerator/` folder. Do not ship only the `.exe`;
it depends on the sibling `_internal/` folder.

## What the spec bundles

- The Python interpreter and standard library.
- Runtime dependencies: PySide6, ReportLab, Pillow, qrcode, num2words, pydantic.
- The SQLite migration scripts (`*.sql`), which are read at runtime via
  `importlib.resources`. They are collected explicitly in the spec because
  PyInstaller does not bundle package data files automatically.

## What the spec does NOT bundle (by design)

User data is resolved at runtime under the per-user application-data directory
by `invoice_generator.config.paths`, **not** inside the install folder:

- Windows: `%LOCALAPPDATA%\InvoiceGenerator\`
  - `database\invoices.db`
  - `backups\`, `exports\`, `assets\`, `logs\`

This separation means reinstalling or upgrading (replacing `dist/`) never
touches existing invoices or backups (DECISIONS D-013).

## Build configuration notes

- One-folder build (`COLLECT`) rather than one-file: faster startup and simpler
  to inspect/debug on a customer machine.
- `console=False`: windowed GUI app, no console window.
- `excludes` drops dev-only tooling (pytest, mypy, ruff) and `tkinter` to keep
  the bundle smaller.
- No UPX compression (`upx=False`) to avoid antivirus false positives.

## Verification performed

On a Windows machine (win32), the build was produced and smoke-tested:

1. `pyinstaller packaging/invoice_generator.spec --noconfirm` reported
   `Build complete!` and produced `dist/InvoiceGenerator/InvoiceGenerator.exe`
   (~8 MB launcher plus the bundled `_internal/` runtime).
2. The migration `*.sql` files are present under
   `_internal/invoice_generator/infrastructure/db/migrations/`.
3. Launching `InvoiceGenerator.exe` created the user data directory at
   `%LOCALAPPDATA%\InvoiceGenerator\` (outside the install/dist folder) with
   `assets`, `backups`, `database`, `exports`, and `logs` subdirectories.
4. First run applied migrations: `database\invoices.db` was created with the
   schema, and `logs\app.log` recorded the startup line.

A clean-environment installation walkthrough is tracked separately in Task 61.
