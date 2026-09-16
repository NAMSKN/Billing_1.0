import { app, dialog, ipcMain, shell } from 'electron';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IpcChannel, type AppInfo, type IpcResult, type ValidationIssue } from '@shared/ipc';
import type { AppPaths } from './paths';
import { PdfService } from './pdf/pdfService';
import { BackupService, type TrustedScope } from './backup/backupService';
import { PaymentStatus } from '@shared/domain/enums';
import { blockingIssues, warningIssues } from '@shared/domain/validation';
import type { CalcPreviewRequest, CompanyDto, CustomerDto, InvoiceDto } from '@shared/dto';
import { buildApplication, type Application } from './app/composition';
import { computePreview } from './app/calcPreview';
import {
  companyFromDto,
  companyToDto,
  customerFromDto,
  customerToDto,
  invoiceFromDto,
  invoiceToDto,
  taxConfigFromDto,
  taxConfigToDto,
} from './app/dtoMappers';
import { FinalizationError } from './app/invoiceService';
import { PartyValidationError, DuplicatePartyError } from './app/partyService';
import { partyToDto, partyInputFromDto, groupToDto } from './app/partyDtoMappers';
import { PartyExcelImporter, type ImportPreview } from './party/excelImport';
import { PartyExcelExporter } from './party/excelExport';
import type {
  ExportRequest,
  ImportAsDto,
  ImportPreviewDto,
  PartyDto,
  PartyListRequest,
} from '@shared/partyDto';
import { PartyType } from '@shared/domain/party';
import { ProductValidationError, DuplicateProductError } from './app/productService';
import { productToDto, productInputFromDto, productGroupToDto } from './app/productDtoMappers';
import { ProductExcelImporter, type ProductImportPreview } from './product/excelImport';
import { ProductExcelExporter } from './product/excelExport';
import { StockExcel } from './product/stockExcel';
import { Money } from '@shared/domain/money';
import type {
  ProductDto,
  ProductExportRequest,
  ProductImportAsDto,
  ProductImportPreviewDto,
  ProductListRequest,
} from '@shared/productDto';
import { ItemType } from '@shared/domain/product';
import type { SettingsDefaults } from '@shared/domain/repositories';
import { randomUUID } from 'node:crypto';

/**
 * Registers all IPC request/response handlers, backed by the wired Application
 * (composition root). Every handler returns an IpcResult envelope so the
 * renderer gets a uniform success/typed-error shape and never sees a raw stack
 * trace. Money crosses the boundary as decimal strings (see dto.ts).
 */
export function registerIpcHandlers(paths: AppPaths): Application {
  const application = buildApplication(paths.databaseFile);
  const { invoiceService, companyRepo, customerRepo, settingsService, pdfService } = application;

  handle<string>(IpcChannel.Ping, async () => 'pong');
  handle<AppInfo>(IpcChannel.AppInfo, async () => ({
    name: app.getName(),
    version: app.getVersion(),
    dataDir: paths.dataDir,
    platform: process.platform,
  }));

  // --- Calculation preview (pure) ---
  handle(IpcChannel.CalcPreview, async (payload) =>
    computePreview(payload as CalcPreviewRequest),
  );

  // --- Company / settings ---
  handle(IpcChannel.CompanyGet, async () => {
    const c = companyRepo.getActive();
    return c ? companyToDto(c) : null;
  });
  handle(IpcChannel.CompanySave, async (payload) => {
    const company = companyFromDto(payload as CompanyDto);
    if (!company.id) {
      company.id = crypto.randomUUID();
    }
    companyRepo.save(company);
    return companyToDto(company);
  });

  handle(IpcChannel.SettingsGet, async () => ({
    tax: taxConfigToDto(settingsService.getTaxRateConfig()),
    numbering: settingsService.getNumberingConfig(),
    defaults: settingsService.getDefaults(),
  }));
  handle(IpcChannel.SettingsSave, async (payload) => {
    const p = payload as {
      tax: ReturnType<typeof taxConfigToDto>;
      numbering: ReturnType<typeof settingsService.getNumberingConfig>;
      defaults: SettingsDefaults;
    };
    settingsService.saveTaxRateConfig(taxConfigFromDto(p.tax));
    settingsService.saveNumberingConfig(p.numbering);
    settingsService.saveDefaults(p.defaults);
    return true;
  });

  // --- Customers ---
  handle(IpcChannel.CustomerList, async (payload) => {
    const includeInactive = (payload as { includeInactive?: boolean } | undefined)?.includeInactive;
    return customerRepo.list(includeInactive).map(customerToDto);
  });
  handle(IpcChannel.CustomerGet, async (id) => {
    const c = customerRepo.get(id as string);
    return c ? customerToDto(c) : null;
  });
  handle(IpcChannel.CustomerSave, async (payload) => {
    const customer = customerFromDto(payload as CustomerDto);
    if (!customer.id) customer.id = crypto.randomUUID();
    customerRepo.save(customer);
    return customerToDto(customer);
  });
  handle(IpcChannel.CustomerArchive, async (id) => {
    customerRepo.archive(id as string);
    return true;
  });

  // --- Invoices ---
  handle(IpcChannel.InvoiceCreateDraft, async () => invoiceToDto(invoiceService.createDraft()));

  handle(IpcChannel.InvoiceSaveDraft, async (payload) => {
    const invoice = invoiceFromDto(payload as InvoiceDto);
    const result = invoiceService.saveDraft(invoice);
    return {
      invoice: invoiceToDto(invoiceService.get(invoice.id)!),
      warnings: toIssues(warningIssues(result)),
    };
  });

  handle(IpcChannel.InvoiceGet, async (id) => {
    const inv = invoiceService.get(id as string);
    return inv ? invoiceToDto(inv) : null;
  });

  handle(IpcChannel.InvoiceListSummaries, async () =>
    invoiceService.listSummaries().map(invoiceToDto),
  );

  handle(IpcChannel.InvoiceCheckReadiness, async (payload) => {
    const p = payload as { invoice: InvoiceDto; invoiceDate: string; dueDate?: string | null };
    const result = invoiceService.checkFinalizationReadiness(invoiceFromDto(p.invoice), {
      invoiceDate: new Date(p.invoiceDate),
      dueDate: p.dueDate ? new Date(p.dueDate) : null,
      today: new Date(),
    });
    return {
      blocking: toIssues(blockingIssues(result)),
      warnings: toIssues(warningIssues(result)),
    };
  });

  handle(IpcChannel.InvoiceFinalize, async (payload) => {
    const p = payload as { id: string; invoiceDate: string; dueDate?: string | null };
    try {
      const inv = invoiceService.finalize(p.id, {
        invoiceDate: new Date(p.invoiceDate),
        dueDate: p.dueDate ? new Date(p.dueDate) : null,
        today: new Date(),
      });
      return invoiceToDto(inv);
    } catch (err) {
      if (err instanceof FinalizationError && err.validation) {
        // Surface blocking issues to the form.
        const issues = toIssues(blockingIssues(err.validation));
        throw new IpcThrown('FINALIZATION_BLOCKED', err.message, issues);
      }
      throw err;
    }
  });

  handle(IpcChannel.InvoiceCancel, async (payload) => {
    const p = payload as { id: string; reason: string; replacementInvoiceId?: string | null };
    return invoiceToDto(
      invoiceService.cancel(p.id, p.reason, new Date(), p.replacementInvoiceId ?? null),
    );
  });

  handle(IpcChannel.InvoiceDuplicate, async (id) =>
    invoiceToDto(invoiceService.duplicate(id as string)),
  );

  handle(IpcChannel.InvoiceSetPaymentStatus, async (payload) => {
    const p = payload as { id: string; status: PaymentStatus };
    return invoiceToDto(invoiceService.setPaymentStatus(p.id, p.status));
  });

  handle(IpcChannel.InvoiceDeleteDraft, async (id) => {
    invoiceService.deleteDraft(id as string);
    return true;
  });

  // --- PDF ---
  handle(IpcChannel.PdfPreview, async (id) => {
    const invoice = invoiceService.get(id as string);
    if (invoice === null) throw new Error('invoice not found');
    const pdf = await pdfService.render(invoice);
    // Write to a temp preview file in the exports dir and open with the OS viewer.
    const previewDir = join(paths.dataDir, 'previews');
    await mkdir(previewDir, { recursive: true });
    const file = join(previewDir, `preview_${invoice.id}.pdf`);
    await writeFile(file, pdf);
    const err = await shell.openPath(file);
    if (err) throw new Error(err);
    return file;
  });

  handle(IpcChannel.PdfExport, async (payload) => {
    const p = payload as { id: string; savePath?: string };
    const invoice = invoiceService.get(p.id);
    if (invoice === null) throw new Error('invoice not found');
    if (!invoice.invoice_number) throw new Error('only finalized invoices can be exported');

    let target = p.savePath;
    if (!target) {
      const defaultPath = PdfService.defaultExportPath(paths.exportsDir, invoice.invoice_number);
      const result = await dialog.showSaveDialog({
        title: 'Export Invoice PDF',
        defaultPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (result.canceled || !result.filePath) throw new Error('export cancelled');
      target = result.filePath;
    }
    return pdfService.export(invoice, target);
  });

  // --- Backup / restore ---
  const backupService = new BackupService(app.getVersion(), paths.backupsDir);

  handle(IpcChannel.BackupCreate, async () => {
    const { backupDir } = await backupService.create(application.db);
    return { backupDir };
  });

  // Reveal a file or folder in the OS file manager (Explorer).
  handle(IpcChannel.RevealPath, async (payload) => {
    const target = (payload as { path?: string }).path;
    if (!target) throw new Error('No path provided');
    shell.showItemInFolder(target);
    return { ok: true };
  });

  handle(IpcChannel.BackupRestore, async (payload) => {
    const p = payload as { backupDir?: string };
    let backupDir = p.backupDir;
    if (!backupDir) {
      const result = await dialog.showOpenDialog({
        title: 'Select a backup folder to restore',
        defaultPath: paths.backupsDir,
        properties: ['openDirectory'],
      });
      if (result.canceled || result.filePaths.length === 0) throw new Error('restore cancelled');
      backupDir = result.filePaths[0];
    }

    // Validate BEFORE touching the live DB.
    await backupService.validate(backupDir);

    // Capture the CURRENT (trusted) numbering high-water before restore (D-029).
    const trusted = application.db
      .prepare(
        'SELECT company_id, financial_year, prefix, high_water_mark FROM invoice_sequences',
      )
      .all() as TrustedScope[];

    // Close the live connection, then restore over it.
    application.close();
    await backupService.restore(backupDir, paths.databaseFile, trusted);

    // The app must relaunch to reopen the restored database; numbering stays
    // blocked (RECONCILIATION_PENDING) until reconciled after relaunch.
    app.relaunch();
    app.exit(0);
    return { restored: true };
  });

  // --- Parties (unified customer/vendor master) ---
  const { partyService, partyGroupService } = application;

  function roleOf(role: PartyListRequest['role']): PartyType | null {
    return role === 'ALL' ? null : role;
  }

  handle(IpcChannel.PartyList, async (payload) => {
    const p = (payload as PartyListRequest) ?? { role: 'ALL', includeArchived: false };
    const parties = p.search
      ? partyService.search(p.search, roleOf(p.role), p.includeArchived)
      : partyService.list(roleOf(p.role), p.includeArchived);
    return parties.map(partyToDto);
  });

  handle(IpcChannel.PartyGet, async (id) => {
    const party = partyService.get(id as string);
    return party ? partyToDto(party) : null;
  });

  handle(IpcChannel.PartySave, async (payload) => {
    const dto = payload as PartyDto;
    const input = partyInputFromDto(dto);
    try {
      const saved = dto.id
        ? partyService.updateParty(dto.id, input, dto.is_active)
        : partyService.createParty(input);
      return partyToDto(saved);
    } catch (err) {
      if (err instanceof PartyValidationError) {
        throw new IpcThrown(
          'PARTY_INVALID',
          err.errors[0] ?? 'Please fix the highlighted fields.',
          err.errors.map((message) => ({ field: '', message, severity: 'blocking' as const })),
        );
      }
      if (err instanceof DuplicatePartyError) {
        throw new IpcThrown('PARTY_DUPLICATE', err.message);
      }
      throw err;
    }
  });

  handle(IpcChannel.PartyArchive, async (id) => {
    return partyService.archive(id as string);
  });

  handle(IpcChannel.PartyGroupList, async () => partyGroupService.listGroups(false).map(groupToDto));

  handle(IpcChannel.PartyGroupCreate, async (name) => groupToDto(partyGroupService.createGroup(name as string)));

  // Import: buildPreview parses+validates; the parsed preview is held server-side
  // keyed by a token so commit reuses it without re-uploading.
  const importCache = new Map<string, ImportPreview>();

  handle(IpcChannel.PartyImportPreview, async (payload) => {
    const p = payload as { importAs: ImportAsDto };
    // Pick the file in the main process (the sandboxed renderer has no fs path).
    const picked = await dialog.showOpenDialog({
      title: 'Import Customers / Vendors from Excel',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) throw new Error('import cancelled');
    const importer = new PartyExcelImporter(partyService);
    const preview = await importer.buildPreview(picked.filePaths[0], p.importAs);
    const token = randomUUID();
    importCache.set(token, preview);
    const dto: ImportPreviewDto = {
      token,
      header_errors: preview.header_errors,
      rows: preview.rows.map((r) => ({
        row_number: r.row_number,
        company_name: r.data?.company_name ?? '(invalid row)',
        errors: r.errors,
        duplicate_of_name: r.duplicate_of_name,
        resolution: r.resolution,
        valid: r.data !== null,
      })),
      valid_count: preview.rows.filter((r) => r.data !== null).length,
      error_count: preview.rows.filter((r) => r.data === null).length,
      duplicate_count: preview.rows.filter((r) => r.data !== null && r.duplicate_of_id).length,
    };
    return dto;
  });

  handle(IpcChannel.PartyImportCommit, async (token) => {
    const preview = importCache.get(token as string);
    if (!preview) throw new Error('import session expired; please re-open the file');
    const importer = new PartyExcelImporter(partyService);
    const result = importer.commit(preview);
    importCache.delete(token as string);
    return result;
  });

  handle(IpcChannel.PartyExport, async (payload) => {
    const req = payload as ExportRequest;
    const suggested = `parties_${req.scope.toLowerCase()}.xlsx`;
    const result = await dialog.showSaveDialog({
      title: 'Export Customers / Vendors',
      defaultPath: join(paths.exportsDir, suggested),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('export cancelled');
    const exporter = new PartyExcelExporter(partyService, partyGroupService);
    return exporter.export(req.scope, result.filePath, req.includeArchived);
  });

  // --- Products / services ---
  const { productService, productGroupService } = application;

  function groupNameMap(): Map<string, string> {
    return new Map(productGroupService.listGroups(true).map((g) => [g.id, g.name]));
  }

  handle(IpcChannel.ProductList, async (payload) => {
    const p = (payload as ProductListRequest) ?? { itemType: 'ALL', includeArchived: false };
    const query = {
      itemType: p.itemType === 'ALL' ? null : (p.itemType as ItemType),
      includeArchived: p.includeArchived,
      groupId: p.groupId ?? null,
    };
    const products = p.search ? productService.search(p.search, query) : productService.list(query);
    const names = groupNameMap();
    return products.map((pr) =>
      productToDto(pr, pr.product_group_id ? names.get(pr.product_group_id) : undefined),
    );
  });

  handle(IpcChannel.ProductGet, async (id) => {
    const product = productService.get(id as string);
    if (!product) return null;
    const names = groupNameMap();
    return productToDto(product, product.product_group_id ? names.get(product.product_group_id) : undefined);
  });

  handle(IpcChannel.ProductSave, async (payload) => {
    const dto = payload as ProductDto;
    const input = productInputFromDto(dto);
    try {
      const saved = dto.id
        ? productService.updateProduct(dto.id, input, dto.is_active)
        : productService.createProduct(input);
      return productToDto(saved);
    } catch (err) {
      if (err instanceof ProductValidationError) {
        throw new IpcThrown(
          'PRODUCT_INVALID',
          err.errors[0] ?? 'Please fix the highlighted fields.',
          err.errors.map((message) => ({ field: '', message, severity: 'blocking' as const })),
        );
      }
      if (err instanceof DuplicateProductError) throw new IpcThrown('PRODUCT_DUPLICATE', err.message);
      throw err;
    }
  });

  handle(IpcChannel.ProductArchive, async (id) => productService.archive(id as string));

  handle(IpcChannel.ProductSellable, async () => {
    const names = groupNameMap();
    return productService
      .sellableProducts()
      .map((p) => productToDto(p, p.product_group_id ? names.get(p.product_group_id) : undefined));
  });

  handle(IpcChannel.ProductGroupList, async () =>
    productGroupService.listGroups(false).map(productGroupToDto),
  );
  handle(IpcChannel.ProductGroupCreate, async (name) =>
    productGroupToDto(productGroupService.createGroup(name as string)),
  );
  handle(IpcChannel.ProductGroupRename, async (payload) => {
    const p = payload as { id: string; name: string };
    return productGroupToDto(productGroupService.renameGroup(p.id, p.name));
  });
  handle(IpcChannel.ProductGroupArchive, async (id) =>
    productGroupToDto(productGroupService.archiveGroup(id as string)),
  );

  const productImportCache = new Map<string, ProductImportPreview>();

  handle(IpcChannel.ProductImportPreview, async (payload) => {
    const p = payload as { importAs: ProductImportAsDto };
    const picked = await dialog.showOpenDialog({
      title: 'Import Products / Services from Excel',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) throw new Error('import cancelled');
    const importer = new ProductExcelImporter(productService, productGroupService);
    const preview = await importer.buildPreview(picked.filePaths[0], p.importAs);
    const token = randomUUID();
    productImportCache.set(token, preview);
    const dto: ProductImportPreviewDto = {
      token,
      header_errors: preview.header_errors,
      rows: preview.rows.map((r) => ({
        row_number: r.row_number,
        name: r.data?.name ?? '(invalid row)',
        errors: r.errors,
        duplicate_of_name: r.duplicate_of_name,
        valid: r.data !== null,
      })),
      valid_count: preview.rows.filter((r) => r.data !== null).length,
      error_count: preview.rows.filter((r) => r.data === null).length,
      duplicate_count: preview.rows.filter((r) => r.data !== null && r.duplicate_of_id).length,
    };
    return dto;
  });

  handle(IpcChannel.ProductImportCommit, async (token) => {
    const preview = productImportCache.get(token as string);
    if (!preview) throw new Error('import session expired; please re-open the file');
    const importer = new ProductExcelImporter(productService, productGroupService);
    const result = importer.commit(preview);
    productImportCache.delete(token as string);
    return result;
  });

  handle(IpcChannel.ProductExport, async (payload) => {
    const req = payload as ProductExportRequest;
    const result = await dialog.showSaveDialog({
      title: 'Export Products / Services',
      defaultPath: join(paths.exportsDir, `products_${req.scope.toLowerCase()}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('export cancelled');
    const exporter = new ProductExcelExporter(productService, productGroupService);
    return exporter.export(req.scope, result.filePath, req.includeArchived);
  });

  // --- Dashboard report ---
  handle(IpcChannel.DashboardReport, async () => application.reportService.build());

  // --- Stock ledger ---
  const { stockService } = application;

  handle(IpcChannel.InventoryGet, async () => settingsService.isInventoryEnabled());
  handle(IpcChannel.InventorySet, async (enabled) => {
    settingsService.setInventoryEnabled(Boolean(enabled));
    return settingsService.isInventoryEnabled();
  });

  handle(IpcChannel.StockList, async () => {
    const names = groupNameMap();
    const stockMap = stockService.currentStockMap();
    return productService
      .list({})
      .filter((p) => p.item_type === ItemType.PRODUCT)
      .map((p) => {
        const current = stockMap.get(p.id);
        const currentStr = current ? current.toString() : '0';
        const low = p.low_stock_alert;
        const isLow = low !== null && Number(currentStr) <= Number(low.toString());
        return {
          product_id: p.id,
          name: p.name,
          group_name: p.product_group_id ? (names.get(p.product_group_id) ?? '') : '',
          unit: p.unit_of_measurement,
          current: currentStr,
          low_stock_alert: low ? low.toString() : null,
          is_low: isLow,
        };
      });
  });

  handle(IpcChannel.StockAdjust, async (payload) => {
    const p = payload as { product_id: string; final_qty: string; remarks: string };
    const r = stockService.adjustToFinal(p.product_id, new Money(p.final_qty || '0'), p.remarks ?? '');
    return { adjusted: r.changed ? 1 : 0, unchanged: r.changed ? 0 : 1 };
  });

  handle(IpcChannel.StockAdjustMany, async (payload) => {
    const p = payload as { entries: { product_id: string; final_qty: string; remarks: string }[] };
    const results = stockService.adjustMany(
      p.entries.map((e) => ({
        productId: e.product_id,
        finalQty: new Money(e.final_qty || '0'),
        remarks: e.remarks ?? '',
      })),
    );
    return {
      adjusted: results.filter((r) => r.changed).length,
      unchanged: results.filter((r) => !r.changed).length,
    };
  });

  handle(IpcChannel.StockLog, async (payload) => {
    const p = payload as { product_id: string; from?: string; to?: string };
    const product = productService.get(p.product_id);
    const movements = stockService.movementsFor(p.product_id, { from: p.from, to: p.to });
    const entries = movements.map((m) => {
      const qty = fromMillisString(m.delta_millis);
      const isIn = m.delta_millis >= 0;
      const info =
        m.reason === 'OPENING'
          ? 'Opening Stock.'
          : m.remarks || (m.reason.charAt(0) + m.reason.slice(1).toLowerCase());
      return {
        date: m.created_at.slice(0, 10),
        info,
        company_name: '',
        doc_no: '',
        unit_price: '',
        stock_in: isIn ? qty : '',
        stock_out: isIn ? '' : qty.replace('-', ''),
        uom: product?.unit_of_measurement ?? '',
      };
    });
    return {
      product_name: product?.name ?? '',
      unit: product?.unit_of_measurement ?? '',
      entries,
    };
  });

  handle(IpcChannel.StockLogExport, async (payload) => {
    const p = payload as { product_id: string; from?: string; to?: string };
    const product = productService.get(p.product_id);
    if (!product) throw new Error('product not found');
    const movements = stockService.movementsFor(p.product_id, { from: p.from, to: p.to });
    const rows = movements.map((m) => {
      const qty = fromMillisString(m.delta_millis);
      const isIn = m.delta_millis >= 0;
      return {
        'Transaction Date': m.created_at.slice(0, 10),
        'Transaction Info': m.reason === 'OPENING' ? 'Opening Stock.' : m.remarks || m.reason,
        'Company Name': '',
        'Doc No.': '',
        'Unit Price': '',
        'Stock In': isIn ? qty : '',
        'Stock Out': isIn ? '' : qty.replace('-', ''),
        UOM: product.unit_of_measurement,
      };
    });
    const result = await dialog.showSaveDialog({
      title: 'Export Product Log',
      defaultPath: join(paths.exportsDir, `product_log_${product.name.replace(/[^a-z0-9]+/gi, '_')}.xlsx`),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('export cancelled');
    const XLSX = await import('xlsx');
    const fsMod = await import('node:fs');
    XLSX.set_fs(fsMod);
    const header = ['Transaction Date', 'Transaction Info', 'Company Name', 'Doc No.', 'Unit Price', 'Stock In', 'Stock Out', 'UOM'];
    const sheet = XLSX.utils.json_to_sheet(rows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, 'Product Log');
    XLSX.writeFile(wb, result.filePath, { bookType: 'xlsx' });
    return result.filePath;
  });

  handle(IpcChannel.StockBulkExport, async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export Current Stock Data',
      defaultPath: join(paths.exportsDir, 'stock.xlsx'),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) throw new Error('export cancelled');
    const excel = new StockExcel(productService, productGroupService, stockService);
    return excel.export(result.filePath);
  });

  const stockImportCache = new Map<string, ReturnType<StockExcel['buildPreview']>>();

  handle(IpcChannel.StockBulkImportPreview, async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Bulk Edit Product Stock — choose Excel file',
      properties: ['openFile'],
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) throw new Error('import cancelled');
    const excel = new StockExcel(productService, productGroupService, stockService);
    const preview = excel.buildPreview(picked.filePaths[0]);
    const token = randomUUID();
    stockImportCache.set(token, preview);
    return {
      token,
      header_errors: preview.header_errors,
      rows: preview.rows,
      adjust_count: preview.adjust_count,
      unchanged_count: preview.unchanged_count,
      error_count: preview.error_count,
    };
  });

  handle(IpcChannel.StockBulkImportCommit, async (token) => {
    const preview = stockImportCache.get(token as string);
    if (!preview) throw new Error('import session expired; please re-open the file');
    const excel = new StockExcel(productService, productGroupService, stockService);
    const result = excel.commit(preview);
    stockImportCache.delete(token as string);
    return result;
  });

  return application;
}

/** Render integer millis as a trimmed decimal-3 string (for stock in/out cells). */
function fromMillisString(millis: number): string {
  const neg = millis < 0;
  const abs = Math.abs(millis);
  const whole = Math.floor(abs / 1000);
  const frac = abs % 1000;
  let s = String(whole);
  if (frac > 0) s += '.' + String(frac).padStart(3, '0').replace(/0+$/, '');
  return neg ? `-${s}` : s;
}

function toIssues(issues: { field: string; message: string; severity: string }[]): ValidationIssue[] {
  return issues.map((i) => ({
    field: i.field,
    message: i.message,
    severity: i.severity === 'BLOCKING' ? 'blocking' : 'warning',
  }));
}

/** A typed error that carries field issues to the renderer. */
class IpcThrown extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues?: ValidationIssue[],
  ) {
    super(message);
  }
}

function handle<T>(channel: string, fn: (payload: unknown) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, payload): Promise<IpcResult<T>> => {
    try {
      const data = await fn(payload);
      return { ok: true, data };
    } catch (err) {
      if (err instanceof IpcThrown) {
        return { ok: false, error: { code: err.code, message: err.message, issues: err.issues } };
      }
      const message = err instanceof Error ? err.message : 'unexpected error';
      return { ok: false, error: { code: 'HANDLER_ERROR', message } };
    }
  });
}
