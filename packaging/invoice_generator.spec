# PyInstaller spec for the Invoice Generator desktop app (Task 60).
#
# Builds a Windows-first, one-folder distribution that bundles the Python
# runtime, third-party dependencies (PySide6, ReportLab, Pillow, qrcode,
# num2words, pydantic), and the application's packaged data files (the SQLite
# migration scripts loaded via importlib.resources).
#
# User data (database, backups, exports, assets, logs) is NOT bundled: it is
# resolved at runtime under the per-user application-data directory by
# invoice_generator.config.paths, keeping user data separate from the install
# directory so upgrades never destroy invoices (DECISIONS D-013; Req 27).
#
# Build from the project root:
#     pyinstaller packaging/invoice_generator.spec --noconfirm
#
# Output: dist/InvoiceGenerator/InvoiceGenerator.exe

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

app_name = "InvoiceGenerator"

# Bundle the migration SQL files, which are read at runtime via
# importlib.resources from the migrations package.
datas = collect_data_files(
    "invoice_generator.infrastructure.db.migrations",
    includes=["*.sql"],
)

# PySide6 and pydantic pull in modules dynamically; collect them so the
# frozen build does not miss an import at runtime. openpyxl (party master
# Excel import/export, V2 F1) also imports some submodules dynamically.
hiddenimports = (
    collect_submodules("pydantic")
    + collect_submodules("openpyxl")
    + collect_submodules("vendor_customer")
    + collect_submodules("common")
)

a = Analysis(
    ["../src/invoice_generator/main.py"],
    pathex=["../src"],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "pytest", "mypy", "ruff"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name=app_name,
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,  # windowed GUI app (no console window)
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name=app_name,
)
