import { describe, it, expect } from 'vitest';
import {
  findBomLoop,
  bomError,
  unitCost,
  materialsNeeded,
  shortages,
  buildProduction,
  type ProductWithBom,
} from './manufacturing';

describe('Manufacturing & BOM Domain Rules', () => {
  const steelBlock: ProductWithBom = {
    id: 'p1',
    name: 'P20 Tool Steel Block',
    unit: 'KG',
    purchase_price_paise: 25000, // ₹250.00 / KG
    stock: 100,
  };

  const guidePin: ProductWithBom = {
    id: 'p2',
    name: 'Guide Pin 25mm',
    unit: 'NOS',
    purchase_price_paise: 15000, // ₹150.00 / NOS
    stock: 20,
  };

  const mouldBase: ProductWithBom = {
    id: 'p3',
    name: 'Standard Mould Base DT-663',
    unit: 'SET',
    madeHere: true,
    stock: 2,
    bom: [
      { productId: 'p1', qty: 50 }, // 50 KG steel
      { productId: 'p2', qty: 4 }, // 4 guide pins
    ],
  };

  const catalog: ProductWithBom[] = [steelBlock, guidePin, mouldBase];

  it('detects missing raw materials and duplicate lines', () => {
    expect(bomError('p3', [], catalog)).toContain('at least one raw material');
    expect(
      bomError(
        'p3',
        [
          { productId: 'p1', qty: 10 },
          { productId: 'p1', qty: 20 },
        ],
        catalog,
      ),
    ).toContain('is in the list twice');
  });

  it('detects circular loops in BOM recipes', () => {
    const loopA: ProductWithBom = {
      id: 'a',
      name: 'Item A',
      madeHere: true,
      bom: [{ productId: 'b', qty: 1 }],
    };
    const loopB: ProductWithBom = {
      id: 'b',
      name: 'Item B',
      madeHere: true,
      bom: [{ productId: 'a', qty: 1 }],
    };

    const loop = findBomLoop('a', loopA.bom!, [loopA, loopB]);
    expect(loop).toContain('Item A -> Item B -> Item A');
  });

  it('calculates correct unit cost from raw material purchase rates', () => {
    // 50 KG * ₹250.00 = ₹12,500
    // 4 NOS * ₹150.00 = ₹600
    // Total = ₹13,100
    const cost = unitCost(mouldBase, catalog);
    expect(cost).toBe(13100);
  });

  it('calculates materials needed and detects inventory shortages', () => {
    // Making 3 Mould Bases requires:
    // 150 KG steel (available: 100 -> shortage: -50)
    // 12 Guide pins (available: 20 -> remaining: 8)
    const stockMap = new Map<string, number>([
      ['p1', 100],
      ['p2', 20],
    ]);

    const reqs = materialsNeeded(mouldBase, 3, catalog, stockMap);
    expect(reqs.length).toBe(2);

    const steelReq = reqs.find((r) => r.productId === 'p1')!;
    expect(steelReq.qtyUsed).toBe(150);
    expect(steelReq.stockAfter).toBe(-50);

    const pinReq = reqs.find((r) => r.productId === 'p2')!;
    expect(pinReq.qtyUsed).toBe(12);
    expect(pinReq.stockAfter).toBe(8);

    const shortList = shortages(reqs);
    expect(shortList.length).toBe(1);
    expect(shortList[0].productId).toBe('p1');
  });

  it('successfully constructs a valid production batch entry', () => {
    const res = buildProduction({
      product: mouldBase,
      qty: 2,
      date: '2026-08-15',
      note: 'Tooling batch for client PO-99',
      products: catalog,
    });

    expect(res.error).toBeUndefined();
    expect(res.entry).toBeDefined();
    expect(res.entry?.qty).toBe(2);
    expect(res.entry?.productName).toBe('Standard Mould Base DT-663');
    expect(res.entry?.cost).toBe(26200); // 2 * 13100
  });
});
