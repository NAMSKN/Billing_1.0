/**
 * Manufacturing & Bill of Materials (BOM) Domain Engine.
 *
 * Implements recipe management, loop detection, unit costing,
 * shortage checks, and production batch calculation for mould manufacturing.
 */

export interface BomLine {
  productId: string;
  qty: string | number; // Quantity needed per 1 unit of finished product
}

export interface MaterialRequirement {
  productId: string;
  name: string;
  unit: string;
  qtyPerUnit: number;
  qtyUsed: number;
  stockBefore: number;
  stockAfter: number;
  rate: number;
  cost: number;
}

export interface ProductionEntry {
  id: string;
  date: string;
  productId: string;
  productName: string;
  unit: string;
  qty: number;
  note: string;
  materials: MaterialRequirement[];
  cost: number;
  createdAt: string;
}

export interface ProductWithBom {
  id: string;
  name: string;
  unit?: string;
  unit_of_measurement?: string;
  stock?: number | string;
  purchase_price_paise?: number;
  sell_price_paise?: number;
  madeHere?: boolean;
  bom?: BomLine[];
}

export function roundQty(qty: number): number {
  return Math.round((qty + Number.EPSILON) * 1000) / 1000;
}

const byId = (products: ProductWithBom[]) =>
  new Map(products.map((p) => [p.id, p]));

/** Detects circular reference loops in BOM recipes (e.g. A uses B, B uses A). */
export function findBomLoop(
  productId: string,
  bom: BomLine[],
  products: ProductWithBom[],
): string {
  const map = byId(products);
  const nameOf = (id: string) => map.get(id)?.name || id;
  const listOf = (id: string): BomLine[] =>
    (id === productId ? bom : map.get(id)?.madeHere ? map.get(id)?.bom : null) || [];

  const walk = (id: string, path: string[]): string[] | null => {
    for (const line of listOf(id)) {
      const next = line?.productId;
      if (!next) continue;
      if (next === productId) return [...path, next];
      if (path.includes(next)) continue;
      const found = walk(next, [...path, next]);
      if (found) return found;
    }
    return null;
  };

  const loop = walk(productId, [productId]);
  return loop ? loop.map(nameOf).join(' -> ') : '';
}

/** Validates BOM list; returns error message or empty string if valid. */
export function bomError(
  productId: string,
  bom: BomLine[],
  products: ProductWithBom[],
): string {
  const map = byId(products);
  if (!bom || !bom.length) return 'Add at least one raw material.';

  const seen = new Set<string>();
  for (const line of bom) {
    if (!line.productId) return 'Choose a product for every raw material line.';
    const m = map.get(line.productId);
    if (!m) return 'Product not found in catalog.';
    if (productId && line.productId === productId) {
      return `${m.name} cannot be a raw material of itself.`;
    }
    if (seen.has(line.productId)) {
      return `${m.name} is in the list twice. Combine the quantities on one line.`;
    }
    seen.add(line.productId);
    const q = Number(line.qty);
    if (!Number.isFinite(q) || q <= 0) {
      return `Quantity of ${m.name} must be greater than 0.`;
    }
  }

  const loop = productId ? findBomLoop(productId, bom, products) : '';
  if (loop) return `Circular loop detected: ${loop}. Remove circular dependency.`;

  return '';
}

/** Calculates estimated manufacturing cost of 1 unit from raw material purchase prices. */
export function unitCost(
  product: ProductWithBom | undefined,
  products: ProductWithBom[],
  seen = new Set<string>(),
): number {
  if (!product?.madeHere || !product.bom?.length || seen.has(product.id)) {
    return (Number(product?.purchase_price_paise) || 0) / 100;
  }

  const map = byId(products);
  const next = new Set([...seen, product.id]);

  const total = product.bom.reduce((sum, line) => {
    const m = map.get(line.productId);
    if (!m) return sum;
    const price =
      (Number(m.purchase_price_paise) || 0) / 100 || unitCost(m, products, next);
    return sum + price * (Number(line.qty) || 0);
  }, 0);

  return Math.round(total * 100) / 100;
}

/** Computes stock requirements and impact for manufacturing `qty` units. */
export function materialsNeeded(
  product: ProductWithBom,
  qty: number,
  products: ProductWithBom[],
  currentStockMap: Map<string, number> = new Map(),
): MaterialRequirement[] {
  const map = byId(products);
  const made = Number(qty) || 0;

  return (product?.bom || []).map((line) => {
    const m = map.get(line.productId);
    const name = m?.name || '(Deleted product)';
    const unit = m?.unit || m?.unit_of_measurement || 'NOS';
    const perUnit = Number(line.qty) || 0;
    const used = roundQty(perUnit * made);
    const before = roundQty(currentStockMap.get(line.productId) ?? Number(m?.stock) ?? 0);
    const after = roundQty(before - used);
    const rate =
      (Number(m?.purchase_price_paise) || 0) / 100 || (m ? unitCost(m, products) : 0);
    const cost = Math.round(rate * used * 100) / 100;

    return {
      productId: line.productId,
      name,
      unit,
      qtyPerUnit: perUnit,
      qtyUsed: used,
      stockBefore: before,
      stockAfter: after,
      rate,
      cost,
    };
  });
}

/** Identifies raw material shortages where workshop stock would go below 0. */
export function shortages(materials: MaterialRequirement[]): MaterialRequirement[] {
  return materials.filter((m) => m.stockAfter < 0);
}

/** Validates and constructs a production entry ready for recording. */
export function buildProduction(params: {
  product: ProductWithBom | undefined;
  qty: number;
  date: string;
  note?: string;
  products: ProductWithBom[];
  currentStockMap?: Map<string, number>;
  id?: string;
}): { entry?: ProductionEntry; error?: string } {
  const { product, qty, date, note = '', products, currentStockMap, id = `mfg_${Date.now()}` } = params;
  const made = roundQty(Number(qty));

  if (!product) return { error: 'Select the finished mould / product to manufacture.' };
  if (!product.madeHere) return { error: `${product.name} is not marked as "Made here from raw materials".` };
  if (!Number.isFinite(made) || made <= 0) return { error: 'Quantity made must be greater than 0.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { error: 'Enter a valid date (YYYY-MM-DD).' };

  const err = bomError(product.id, product.bom || [], products);
  if (err) return { error: `${product.name}: ${err}` };

  const materials = materialsNeeded(product, made, products, currentStockMap);
  const totalCost = Math.round(materials.reduce((s, m) => s + m.cost, 0) * 100) / 100;

  return {
    entry: {
      id,
      date,
      productId: product.id,
      productName: product.name,
      unit: product.unit || product.unit_of_measurement || 'NOS',
      qty: made,
      note: String(note || '').trim(),
      materials,
      cost: totalCost,
      createdAt: new Date().toISOString(),
    },
  };
}
