/**
 * IPC channel contract shared between the main process and the renderer.
 *
 * Security model: the renderer has NO direct access to Node, the filesystem,
 * SQLite, or PDF generation. Every capability is a named, typed channel routed
 * through the contextBridge preload (see src/preload/index.ts) and handled in
 * the main process. Keeping the contract in one shared module lets both sides
 * stay type-safe without leaking implementation.
 *
 * All monetary values that cross the boundary are serialized as decimal
 * strings (e.g. "12280.00"), never JS floats, to preserve exactness. The main
 * process converts to/from Decimal and integer paise at its own boundary.
 */

/** Channels the renderer may invoke (request/response via ipcRenderer.invoke). */
export const IpcChannel = {
  Ping: 'app:ping',
  AppInfo: 'app:info',
  ClipboardWrite: 'app:clipboardWrite',

  // Calculation preview (pure, no persistence) — used for live UI totals.
  CalcPreview: 'calc:preview',

  // Company / settings
  CompanyGet: 'company:get',
  CompanySave: 'company:save',
  SettingsGet: 'settings:get',
  SettingsSave: 'settings:save',

  // Customers
  CustomerList: 'customer:list',
  CustomerGet: 'customer:get',
  CustomerSave: 'customer:save',
  CustomerArchive: 'customer:archive',

  // Invoices
  InvoiceCreateDraft: 'invoice:createDraft',
  InvoiceSaveDraft: 'invoice:saveDraft',
  InvoiceGet: 'invoice:get',
  InvoiceListSummaries: 'invoice:listSummaries',
  InvoiceCheckReadiness: 'invoice:checkReadiness',
  InvoiceFinalize: 'invoice:finalize',
  InvoiceCancel: 'invoice:cancel',
  InvoiceDuplicate: 'invoice:duplicate',
  InvoiceSetPaymentStatus: 'invoice:setPaymentStatus',
  InvoiceDeleteDraft: 'invoice:deleteDraft',

  // PDF
  PdfPreview: 'pdf:preview',
  PdfExport: 'pdf:export',

  // Delivery Challans
  ChallanCreateDraft: 'challan:createDraft',
  ChallanSaveDraft: 'challan:saveDraft',
  ChallanGet: 'challan:get',
  ChallanListSummaries: 'challan:listSummaries',
  ChallanFinalize: 'challan:finalize',
  ChallanCancel: 'challan:cancel',
  ChallanDuplicate: 'challan:duplicate',
  ChallanDeleteDraft: 'challan:deleteDraft',
  ChallanPdfPreview: 'challan:pdfPreview',
  ChallanPdfExport: 'challan:pdfExport',

  // Orders (Sales Order / Purchase Order / Service Request)
  OrderCreateDraft: 'order:createDraft',
  OrderSaveDraft: 'order:saveDraft',
  OrderGet: 'order:get',
  OrderListSummaries: 'order:listSummaries',
  OrderConfirm: 'order:confirm',
  OrderComplete: 'order:complete',
  OrderCancel: 'order:cancel',
  OrderDuplicate: 'order:duplicate',
  OrderDeleteDraft: 'order:deleteDraft',
  OrderConvertToInvoice: 'order:convertToInvoice',
  OrderPdfPreview: 'order:pdfPreview',
  OrderPdfExport: 'order:pdfExport',

  // Receipt / Payment vouchers
  PaymentCreateDraft: 'payment:createDraft',
  PaymentSaveDraft: 'payment:saveDraft',
  PaymentGet: 'payment:get',
  PaymentListSummaries: 'payment:listSummaries',
  PaymentFinalize: 'payment:finalize',
  PaymentCancel: 'payment:cancel',
  PaymentDeleteDraft: 'payment:deleteDraft',
  PaymentDuplicate: 'payment:duplicate',
  PaymentAllocatableInvoices: 'payment:allocatableInvoices',
  PaymentSetDraftAllocations: 'payment:setDraftAllocations',
  PaymentConfirmAllocations: 'payment:confirmAllocations',
  PaymentPdfPreview: 'payment:pdfPreview',
  PaymentPdfExport: 'payment:pdfExport',

  // Backup / restore
  BackupCreate: 'backup:create',
  BackupRestore: 'backup:restore',
  RevealPath: 'shell:revealPath',

  // Parties (unified customer/vendor master)
  PartyList: 'party:list',
  PartyGet: 'party:get',
  PartySave: 'party:save',
  PartyArchive: 'party:archive',
  PartyGroupList: 'party:groupList',
  PartyGroupCreate: 'party:groupCreate',
  PartyImportPreview: 'party:importPreview',
  PartyImportCommit: 'party:importCommit',
  PartyExport: 'party:export',

  // Products / services
  ProductList: 'product:list',
  ProductGet: 'product:get',
  ProductSave: 'product:save',
  ProductArchive: 'product:archive',
  ProductSellable: 'product:sellable',
  ProductGroupList: 'product:groupList',
  ProductGroupCreate: 'product:groupCreate',
  ProductGroupRename: 'product:groupRename',
  ProductGroupArchive: 'product:groupArchive',
  ProductImportPreview: 'product:importPreview',
  ProductImportCommit: 'product:importCommit',
  ProductExport: 'product:export',

  // Dashboard / reporting
  DashboardReport: 'dashboard:report',

  // Stock ledger
  StockList: 'stock:list',
  StockAdjust: 'stock:adjust',
  StockAdjustMany: 'stock:adjustMany',
  StockLog: 'stock:log',
  StockBulkExport: 'stock:bulkExport',
  StockBulkImportPreview: 'stock:bulkImportPreview',
  StockBulkImportCommit: 'stock:bulkImportCommit',
  StockLogExport: 'stock:logExport',
  InventoryGet: 'inventory:get',
  InventorySet: 'inventory:set',

  // Manufacturing & BOM (Bill of Materials)
  ManufacturingGetBom: 'manufacturing:getBom',
  ManufacturingSaveBom: 'manufacturing:saveBom',
  ManufacturingRecordProduction: 'manufacturing:recordProduction',
  ManufacturingListBatches: 'manufacturing:listBatches',
  ManufacturingDeleteBatch: 'manufacturing:deleteBatch',

  // Cash Book
  CashBookList: 'cash:list',
  CashBookSave: 'cash:save',
  CashBookDelete: 'cash:delete',

  // Cost Centres
  CostCentreList: 'costCentre:list',
  CostCentreSave: 'costCentre:save',
  CostCentreArchive: 'costCentre:archive',

  // App Lock & Security
  AppLockGetStatus: 'appLock:getStatus',
  AppLockSetPin: 'appLock:setPin',
  AppLockDisable: 'appLock:disable',
  AppLockVerifyPin: 'appLock:verifyPin',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

/** A uniform envelope so the renderer can distinguish success from typed errors. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError };

export interface IpcError {
  code: string;
  message: string;
  /** Optional field-level validation issues for form surfaces. */
  issues?: ValidationIssue[];
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'blocking' | 'warning';
}

export interface AppInfo {
  name: string;
  version: string;
  dataDir: string;
  platform: string;
}
