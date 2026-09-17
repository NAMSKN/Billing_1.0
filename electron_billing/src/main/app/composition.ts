import type Database from 'better-sqlite3';
import { connect } from '../db/connection';
import { SqliteCompanyRepository } from '../db/companyRepository';
import { SqliteCustomerRepository } from '../db/customerRepository';
import { SqliteInvoiceRepository } from '../db/invoiceRepository';
import { SqliteChallanRepository } from '../db/challanRepository';
import { SqliteOrderRepository } from '../db/orderRepository';
import { SqliteSequenceRepository } from '../db/sequenceRepository';
import { SqliteSettingsRepository } from '../db/settingsRepository';
import { SqliteAssetRepository } from '../db/assetRepository';
import { SqlitePartyRepository } from '../db/partyRepository';
import { SqlitePartyGroupRepository } from '../db/partyGroupRepository';
import { InvoiceCustomerProjection } from '../db/customerProjection';
import { PartyService } from './partyService';
import { PartyGroupService } from './partyGroupService';
import { SqliteProductRepository } from '../db/productRepository';
import { SqliteProductGroupRepository } from '../db/productGroupRepository';
import { ProductService } from './productService';
import { ProductGroupService } from './productGroupService';
import { SqliteStockMovementRepository } from '../db/stockMovementRepository';
import { StockService } from './stockService';
import { ReportService } from './reportService';
import { NumberingService } from './numberingService';
import { SettingsService } from './settingsService';
import { InvoiceService } from './invoiceService';
import { ChallanService } from './challanService';
import { OrderService } from './orderService';
import { MetadataReconciliationGate } from './reconciliationGate';
import { ReconciliationService } from './reconciliationService';
import { PdfService } from '../pdf/pdfService';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

/**
 * Composition root (DECISIONS D-021): wire dependencies once via constructor
 * injection. No service locator, no global mutable container. Tests can inject
 * a deterministic clock/id generator and an in-memory connection.
 */
export interface Application {
  db: Database.Database;
  companyRepo: SqliteCompanyRepository;
  customerRepo: SqliteCustomerRepository;
  invoiceRepo: SqliteInvoiceRepository;
  assetRepo: SqliteAssetRepository;
  settingsService: SettingsService;
  numberingService: NumberingService;
  invoiceService: InvoiceService;
  challanService: ChallanService;
  orderService: OrderService;
  pdfService: PdfService;
  reconciliationService: ReconciliationService;
  partyService: PartyService;
  partyGroupService: PartyGroupService;
  productService: ProductService;
  productGroupService: ProductGroupService;
  stockService: StockService;
  reportService: ReportService;
  close(): void;
}

export interface BuildOptions {
  idGenerator?: IdGenerator;
  clock?: Clock;
}

export function buildApplication(
  databaseFile: string,
  options: BuildOptions = {},
): Application {
  const db = connect(databaseFile);
  return buildApplicationFromDb(db, options);
}

/** Build from an existing connection (used by tests with an in-memory DB). */
export function buildApplicationFromDb(
  db: Database.Database,
  options: BuildOptions = {},
): Application {
  const ids = options.idGenerator ?? uuid4Generator;
  const clock = options.clock ?? systemClock;

  const companyRepo = new SqliteCompanyRepository(db);
  const customerRepo = new SqliteCustomerRepository(db);
  const invoiceRepo = new SqliteInvoiceRepository(db);
  const sequenceRepo = new SqliteSequenceRepository(db);
  const settingsRepo = new SqliteSettingsRepository(db);
  const assetRepo = new SqliteAssetRepository(db);

  const settingsService = new SettingsService(settingsRepo);
  const pdfService = new PdfService();
  const numberingService = new NumberingService(sequenceRepo, new MetadataReconciliationGate(db));
  const reconciliationService = new ReconciliationService(db, numberingService);

  // Party (customer/vendor) master. A customer-capable party is mirrored into
  // the invoice-facing `customers` table (same UUID) via the projection so
  // invoice selection/finalization/snapshots keep working (D-034). The party
  // repo is also the source for a PURCHASE invoice's vendor.
  const partyRepo = new SqlitePartyRepository(db);
  const partyGroupRepo = new SqlitePartyGroupRepository(db);

  const invoiceService = new InvoiceService(
    db,
    invoiceRepo,
    companyRepo,
    customerRepo,
    numberingService,
    settingsService,
    partyRepo,
    ids,
    clock,
  );
  const partyService = new PartyService(
    partyRepo,
    ids,
    clock,
    new InvoiceCustomerProjection(customerRepo),
  );
  const partyGroupService = new PartyGroupService(partyGroupRepo, ids);

  // Delivery Challan: a movement-of-goods document whose counterparty may be a
  // customer OR a vendor (resolved from the party master). Reuses the calc
  // engine and the shared numbering service (distinct 'DC' prefix).
  const challanRepo = new SqliteChallanRepository(db);
  const challanService = new ChallanService(
    db,
    challanRepo,
    companyRepo,
    partyRepo,
    numberingService,
    settingsService,
    ids,
    clock,
  );

  // Orders (Sales Order / Purchase Order / Service Request). Confirmed sales
  // orders and service requests can be converted into a NEW invoice draft
  // (tax recalculated at finalize); the source order stays a reference.
  const orderRepo = new SqliteOrderRepository(db);
  const orderService = new OrderService(
    db,
    orderRepo,
    companyRepo,
    partyRepo,
    invoiceService,
    numberingService,
    settingsService,
    ids,
    clock,
  );

  // Product / Service master. Independent master data; the product row never
  // stores GST calculations (the engine owns those) and never rewrites
  // finalized invoice snapshots.
  const productRepo = new SqliteProductRepository(db);
  const productGroupRepo = new SqliteProductGroupRepository(db);
  const productService = new ProductService(productRepo, ids, clock);
  const productGroupService = new ProductGroupService(productGroupRepo, ids);

  // Stock ledger: current stock is derived from append-only movements. Opening
  // quantities are backfilled once (idempotent) so history starts consistent.
  const stockMovementRepo = new SqliteStockMovementRepository(db);
  const stockService = new StockService(db, stockMovementRepo, productService, ids, clock);
  stockService.backfillOpening();

  // Dashboard reporting derives everything from persisted invoices + products.
  const reportService = new ReportService(invoiceRepo, productService, clock);

  return {
    db,
    companyRepo,
    customerRepo,
    invoiceRepo,
    assetRepo,
    settingsService,
    numberingService,
    invoiceService,
    challanService,
    orderService,
    pdfService,
    reconciliationService,
    partyService,
    partyGroupService,
    productService,
    productGroupService,
    stockService,
    reportService,
    close: () => db.close(),
  };
}
