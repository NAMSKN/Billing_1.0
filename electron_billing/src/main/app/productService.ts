import type Decimal from 'decimal.js';
import {
  CessType,
  DiscountType,
  ItemType,
  StockType,
  tracksStock,
  type Product,
} from '@shared/domain/product';
import { validateProduct } from '@shared/domain/productValidation';
import type { ProductRepository, ProductQuery } from '../db/productRepository';
import type { Clock, IdGenerator } from './clock';
import { systemClock, uuid4Generator } from './clock';

/**
 * Product application service (faithful port). Owns create/update/query/archive.
 * Non-PRODUCT items never carry stock: stock config is normalized away on save.
 * A barcode duplicate is rejected. The engine (not the product) owns GST.
 */

export class ProductValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors.join(' '));
    this.name = 'ProductValidationError';
  }
}
export class DuplicateProductError extends Error {
  constructor(
    message: string,
    public readonly existingId: string,
  ) {
    super(message);
    this.name = 'DuplicateProductError';
  }
}

export interface ProductInput {
  item_type: ItemType;
  name: string;
  note: string;
  barcode_no: string;
  hsn_sac_code: string;
  unit_of_measurement: string;
  tax_rate: Decimal;
  cess_percent: Decimal;
  cess_type: CessType;
  cess_amount: Decimal;
  no_itc: boolean;
  sell_price: Decimal;
  sell_price_incl_tax: Decimal;
  sale_discount_type: DiscountType;
  sale_discount_value: Decimal;
  purchase_price: Decimal;
  purchase_price_incl_tax: Decimal;
  purchase_discount_type: DiscountType;
  purchase_discount_value: Decimal;
  stock_type: StockType;
  opening_qty: Decimal | null;
  low_stock_alert: Decimal | null;
  product_group_id: string | null;
  image_asset_id: string | null;
  is_manufactured: boolean;
  is_sellable: boolean;
  visible_on_documents: boolean;
}

export class ProductService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly ids: IdGenerator = uuid4Generator,
    private readonly clock: Clock = systemClock,
  ) {}

  createProduct(data: ProductInput): Product {
    const now = this.clock.now().toISOString();
    const product = this.assemble(this.ids(), data, true, now, now);
    this.rejectIfInvalid(product);
    this.rejectIfDuplicate(product);
    this.repo.save(product);
    return product;
  }

  updateProduct(id: string, data: ProductInput, isActive: boolean): Product {
    const existing = this.repo.get(id);
    const createdAt = existing ? existing.created_at : '';
    const product = this.assemble(id, data, isActive, createdAt, this.clock.now().toISOString());
    this.rejectIfInvalid(product);
    this.rejectIfDuplicate(product);
    this.repo.save(product);
    return product;
  }

  get(id: string): Product | null {
    return this.repo.get(id);
  }

  list(query: ProductQuery = {}): Product[] {
    return this.repo.listAll(query);
  }

  search(term: string, query: ProductQuery = {}): Product[] {
    const needle = term.trim();
    if (!needle) return this.repo.listAll(query);
    return this.repo.search(needle, query);
  }

  /** Active, sellable items for new sales documents (invoice picker). */
  sellableProducts(itemType: ItemType | null = null): Product[] {
    return this.repo.listAll({ itemType, includeArchived: false, sellableOnly: true });
  }

  archive(id: string): boolean {
    return this.repo.archive(id);
  }

  findDuplicate(data: ProductInput): Product | null {
    const barcode = data.barcode_no.trim();
    if (barcode) {
      const match = this.repo.getByBarcode(barcode);
      if (match) return match;
    }
    if (data.name.trim()) {
      return this.repo.findByNameAndType(data.name, data.item_type);
    }
    return null;
  }

  // --- internals ---

  private assemble(
    id: string,
    data: ProductInput,
    isActive: boolean,
    createdAt: string,
    updatedAt: string,
  ): Product {
    const stocks = tracksStock(data.item_type);
    return {
      id,
      item_type: data.item_type,
      name: data.name.trim(),
      note: data.note.trim(),
      barcode_no: data.barcode_no.trim(),
      hsn_sac_code: data.hsn_sac_code.trim(),
      unit_of_measurement: data.unit_of_measurement.trim(),
      tax_rate: data.tax_rate,
      cess_percent: data.cess_percent,
      cess_type: data.cess_type,
      cess_amount: data.cess_amount,
      no_itc: data.no_itc,
      sell_price: data.sell_price,
      sell_price_incl_tax: data.sell_price_incl_tax,
      sale_discount_type: data.sale_discount_type,
      sale_discount_value: data.sale_discount_value,
      purchase_price: data.purchase_price,
      purchase_price_incl_tax: data.purchase_price_incl_tax,
      purchase_discount_type: data.purchase_discount_type,
      purchase_discount_value: data.purchase_discount_value,
      // Services / additional charges never carry stock.
      stock_type: stocks ? data.stock_type : StockType.NORMAL,
      opening_qty: stocks ? data.opening_qty : null,
      low_stock_alert: stocks ? data.low_stock_alert : null,
      product_group_id: data.product_group_id,
      image_asset_id: data.image_asset_id,
      is_manufactured: data.is_manufactured,
      is_sellable: data.is_sellable,
      visible_on_documents: data.visible_on_documents,
      is_active: isActive,
      created_at: createdAt,
      updated_at: updatedAt,
    };
  }

  private rejectIfInvalid(product: Product): void {
    const errors = validateProduct(product);
    if (errors.length) throw new ProductValidationError(errors);
  }

  private rejectIfDuplicate(product: Product): void {
    const barcode = product.barcode_no.trim();
    if (!barcode) return;
    const existing = this.repo.getByBarcode(barcode);
    if (existing && existing.id !== product.id) {
      throw new DuplicateProductError(
        `A product with barcode '${barcode}' already exists.`,
        existing.id,
      );
    }
  }
}
