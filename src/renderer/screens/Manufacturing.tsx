import { useEffect, useMemo, useState } from 'react';
import {
  Factory,
  Plus,
  Trash2,
  AlertTriangle,
  Package,
  RefreshCw,
} from 'lucide-react';
import type { ProductDto } from '@shared/productDto';
import { unwrap } from '../lib/api';
import { rupees } from '../lib/format';
import { Button, Card, Input, Select } from '../components/ui';
import { PageHeader } from '../components/PageHeader';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import {
  bomError,
  unitCost,
  materialsNeeded,
  shortages,
  type BomLine,
  type MaterialRequirement,
  type ProductWithBom,
} from '@shared/domain/manufacturing';

interface ProductionBatch {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: string;
  productionDate: string;
  costRupees: string;
  note: string;
  materials: MaterialRequirement[];
  createdAt: string;
}

export function Manufacturing() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'batches' | 'recipes'>('batches');
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());

  // BOM Editor state
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [currentBom, setCurrentBom] = useState<BomLine[]>([]);
  const [loadingBom, setLoadingBom] = useState(false);

  // Make Modal state
  const [makeModalOpen, setMakeModalOpen] = useState(false);
  const [makeProductId, setMakeProductId] = useState('');
  const [makeQty, setMakeQty] = useState('1');
  const [makeDate, setMakeDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [makeNote, setMakeNote] = useState('');
  const [submittingMake, setSubmittingMake] = useState(false);

  // Batch Detail Modal
  const [viewBatch, setViewBatch] = useState<ProductionBatch | null>(null);

  const loadData = async () => {
    try {
      const [prods, batchList] = await Promise.all([
        unwrap<ProductDto[]>(window.api.products.list({ includeArchived: false })),
        unwrap<ProductionBatch[]>(window.api.manufacturing.listBatches()),
      ]);
      setProducts(prods);
      setBatches(batchList);

      // Fetch stock for all products
      const sMap = new Map<string, number>();
      for (const p of prods) {
        sMap.set(p.id, Number(p.opening_qty) || 0); // fallback or derived
      }
      setStockMap(sMap);

      if (prods.length > 0 && !selectedProductId) {
        setSelectedProductId(prods[0].id);
      }
    } catch {
      toast.error('Failed to load manufacturing data');
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  // When selected product changes in recipe editor, load its BOM
  useEffect(() => {
    if (!selectedProductId) return;
    setLoadingBom(true);
    window.api.manufacturing
      .getBom(selectedProductId)
      .then((res) => {
        if (res.ok) {
          setCurrentBom(res.data || []);
        }
      })
      .catch(() => toast.error('Failed to load recipe'))
      .finally(() => setLoadingBom(false));
  }, [selectedProductId]);

  // Transform products for manufacturing domain functions
  const catalogWithBoms: ProductWithBom[] = useMemo(() => {
    return products.map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit_of_measurement,
      purchase_price_paise: Math.round(Number(p.purchase_price || 0) * 100),
      sell_price_paise: Math.round(Number(p.sell_price || 0) * 100),
      stock: stockMap.get(p.id) || 0,
      madeHere: p.id === selectedProductId ? currentBom.length > 0 : undefined,
      bom: p.id === selectedProductId ? currentBom : undefined,
    }));
  }, [products, stockMap, selectedProductId, currentBom]);

  // Handle saving recipe (BOM)
  const handleSaveRecipe = async () => {
    if (!selectedProductId) return;
    const err = bomError(selectedProductId, currentBom, catalogWithBoms);
    if (err) {
      toast.error(err);
      return;
    }

    try {
      await unwrap(
        window.api.manufacturing.saveBom({
          productId: selectedProductId,
          lines: currentBom,
        }),
      );
      toast.success('Bill of Materials saved successfully');
      void loadData();
    } catch {
      toast.error('Failed to save recipe');
    }
  };

  // Recipe line modifications
  const addRecipeLine = () => {
    const candidate = products.find((p) => p.id !== selectedProductId && !currentBom.some((l) => l.productId === p.id));
    if (!candidate) {
      toast.error('No more raw materials available to add');
      return;
    }
    setCurrentBom([...currentBom, { productId: candidate.id, qty: '1' }]);
  };

  const removeRecipeLine = (index: number) => {
    setCurrentBom(currentBom.filter((_, i) => i !== index));
  };

  const updateRecipeLine = (index: number, patch: Partial<BomLine>) => {
    setCurrentBom(
      currentBom.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  };

  // Selected product's estimated unit manufacturing cost
  const selectedProductCost = useMemo(() => {
    const prod = catalogWithBoms.find((p) => p.id === selectedProductId);
    if (!prod) return 0;
    return unitCost({ ...prod, madeHere: true, bom: currentBom }, catalogWithBoms);
  }, [catalogWithBoms, selectedProductId, currentBom]);

  // Make Modal requirements & shortages computation
  const makeProduct = useMemo(
    () => products.find((p) => p.id === makeProductId),
    [products, makeProductId],
  );

  const [makeBom, setMakeBom] = useState<BomLine[]>([]);

  useEffect(() => {
    if (!makeProductId) {
      setMakeBom([]);
      return;
    }
    window.api.manufacturing.getBom(makeProductId).then((res) => {
      if (res.ok) setMakeBom(res.data || []);
    });
  }, [makeProductId]);

  const makeRequirements = useMemo(() => {
    if (!makeProduct || makeBom.length === 0) return [];
    const pWithBom: ProductWithBom = {
      id: makeProduct.id,
      name: makeProduct.name,
      unit: makeProduct.unit_of_measurement,
      madeHere: true,
      bom: makeBom,
    };
    return materialsNeeded(pWithBom, Number(makeQty) || 0, catalogWithBoms, stockMap);
  }, [makeProduct, makeBom, makeQty, catalogWithBoms, stockMap]);

  const makeShortages = useMemo(() => shortages(makeRequirements), [makeRequirements]);

  const handleConfirmMake = async () => {
    if (!makeProductId) {
      toast.error('Please select a product');
      return;
    }
    const q = Number(makeQty);
    if (!q || q <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    setSubmittingMake(true);
    try {
      await unwrap(
        window.api.manufacturing.recordProduction({
          productId: makeProductId,
          quantity: q,
          date: makeDate,
          note: makeNote,
        }),
      );
      toast.success(`Successfully manufactured ${q} unit(s) of ${makeProduct?.name}`);
      setMakeModalOpen(false);
      setMakeNote('');
      void loadData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Production failed';
      toast.error(msg);
    } finally {
      setSubmittingMake(false);
    }
  };

  const handleDeleteBatch = async (batch: ProductionBatch) => {
    if (
      !window.confirm(
        `Delete production batch ${batch.id}? Raw materials will be credited back, and finished stock deducted.`,
      )
    ) {
      return;
    }
    try {
      await unwrap(window.api.manufacturing.deleteBatch(batch.id));
      toast.success('Production batch deleted and stock restored');
      void loadData();
    } catch {
      toast.error('Failed to delete production batch');
    }
  };

  const totalBatchesCost = useMemo(() => {
    return batches.reduce((sum, b) => sum + (Number(b.costRupees) || 0), 0);
  }, [batches]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Manufacturing & Assembly (BOM)"
        description="Manage mould component recipes (Bill of Materials), record production runs, and auto-consume raw materials."
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => {
              if (products.length > 0) setMakeProductId(products[0].id);
              setMakeModalOpen(true);
            }}>
              <Factory className="h-3.5 w-3.5 mr-1" /> Record Production (Make)
            </Button>
            <Button variant="outline" size="sm" onClick={loadData}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Production Runs</div>
          <div className="text-xl font-bold mt-1 text-foreground">{batches.length} batches</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Completed machining runs</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Material Production Cost</div>
          <div className="text-xl font-bold mt-1 text-accent">{rupees(totalBatchesCost.toFixed(2))}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Raw materials consumed</div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total Catalog Items</div>
          <div className="text-xl font-bold mt-1 text-foreground">{products.length} products</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">Raw materials & assemblies</div>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border text-sm">
        <button
          onClick={() => setActiveTab('batches')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'batches'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Production History ({batches.length})
        </button>
        <button
          onClick={() => setActiveTab('recipes')}
          className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'recipes'
              ? 'border-accent text-accent'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          Bill of Materials (BOM Recipes)
        </button>
      </div>

      {/* ===================== PRODUCTION BATCHES TAB ===================== */}
      {activeTab === 'batches' && (
        <Card className="overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">Machining & Assembly History</h3>
            <span className="text-xs text-muted-foreground">{batches.length} recorded runs</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                <tr>
                  <th className="p-2.5">Date</th>
                  <th className="p-2.5">Batch ID</th>
                  <th className="p-2.5">Finished Product</th>
                  <th className="p-2.5 text-right">Qty Made</th>
                  <th className="p-2.5 text-right">Materials Cost</th>
                  <th className="p-2.5">Notes</th>
                  <th className="p-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">
                      No production batches recorded yet. Click &ldquo;Record Production (Make)&rdquo; to manufacture your first batch.
                    </td>
                  </tr>
                ) : (
                  batches.map((b) => (
                    <tr key={b.id} className="hover:bg-muted/30">
                      <td className="p-2.5 font-medium">{b.productionDate}</td>
                      <td className="p-2.5 font-mono text-[11px] text-muted-foreground">{b.id}</td>
                      <td className="p-2.5 font-semibold text-foreground">{b.productName}</td>
                      <td className="p-2.5 text-right font-medium">
                        {b.quantity} {b.unit}
                      </td>
                      <td className="p-2.5 text-right text-accent font-medium">
                        {rupees(b.costRupees)}
                      </td>
                      <td className="p-2.5 text-muted-foreground max-w-xs truncate">{b.note || '—'}</td>
                      <td className="p-2.5 text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setViewBatch(b)}
                        >
                          View
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-danger hover:text-danger hover:bg-danger/10"
                          onClick={() => handleDeleteBatch(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ===================== BOM RECIPES TAB ===================== */}
      {activeTab === 'recipes' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Product selector */}
          <Card className="p-4 space-y-3">
            <h4 className="text-sm font-semibold flex items-center gap-1.5">
              <Package className="h-4 w-4 text-accent" />
              <span>Select Product to Edit Recipe</span>
            </h4>
            <div className="space-y-1">
              {products.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProductId(p.id)}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors flex items-center justify-between ${
                    selectedProductId === p.id
                      ? 'bg-accent text-accent-foreground shadow-sm'
                      : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <span className="truncate">{p.name}</span>
                  <span className="text-[10px] opacity-70 ml-2">{p.unit_of_measurement}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* Recipe Editor */}
          <Card className="p-5 md:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
              <div>
                <h3 className="text-base font-semibold">
                  Recipe for: {products.find((p) => p.id === selectedProductId)?.name || 'Select Product'}
                </h3>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Estimated 1-Unit Material Cost:{' '}
                  <span className="font-semibold text-accent">{rupees(selectedProductCost.toFixed(2))}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={addRecipeLine}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Raw Material
                </Button>
                <Button size="sm" onClick={handleSaveRecipe}>
                  Save Recipe
                </Button>
              </div>
            </div>

            {loadingBom ? (
              <div className="p-8 text-center text-xs text-muted-foreground">Loading recipe...</div>
            ) : currentBom.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground border-2 border-dashed border-border rounded-lg">
                No materials specified. Click &ldquo;Add Raw Material&rdquo; above to define what goes into making 1 unit of this product.
              </div>
            ) : (
              <div className="space-y-3">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted text-muted-foreground font-medium border-b border-border">
                    <tr>
                      <th className="p-2">Raw Material</th>
                      <th className="p-2 w-28">Qty per 1 Unit</th>
                      <th className="p-2 w-20">Unit</th>
                      <th className="p-2 w-12 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {currentBom.map((line, idx) => {
                      const matProduct = products.find((p) => p.id === line.productId);
                      return (
                        <tr key={idx}>
                          <td className="p-2">
                            <Select
                              className="text-xs h-8"
                              value={line.productId}
                              onChange={(e) => updateRecipeLine(idx, { productId: e.target.value })}
                            >
                              {products
                                .filter((p) => p.id !== selectedProductId)
                                .map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.name}
                                  </option>
                                ))}
                            </Select>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min="0.001"
                              step="any"
                              className="text-xs h-8"
                              value={line.qty}
                              onChange={(e) => updateRecipeLine(idx, { qty: e.target.value })}
                            />
                          </td>
                          <td className="p-2 text-muted-foreground font-medium">
                            {matProduct?.unit_of_measurement || 'NOS'}
                          </td>
                          <td className="p-2 text-right">
                            <button
                              onClick={() => removeRecipeLine(idx)}
                              className="p-1 text-danger hover:bg-danger/10 rounded"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ===================== RECORD PRODUCTION MODAL (MAKE) ===================== */}
      {makeModalOpen && (
        <Modal
          open={true}
          title="Record Production Run (Make Batch)"
          onClose={() => setMakeModalOpen(false)}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 font-medium text-muted-foreground">Product to Manufacture</label>
                <Select
                  value={makeProductId}
                  onChange={(e) => setMakeProductId(e.target.value)}
                  className="h-9 text-xs"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="block mb-1 font-medium text-muted-foreground">Quantity to Make</label>
                <Input
                  type="number"
                  min="1"
                  step="any"
                  value={makeQty}
                  onChange={(e) => setMakeQty(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 font-medium text-muted-foreground">Production Date</label>
                <Input
                  type="date"
                  value={makeDate}
                  onChange={(e) => setMakeDate(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div>
                <label className="block mb-1 font-medium text-muted-foreground">Notes / Order Ref</label>
                <Input
                  placeholder="e.g. For client PO-441"
                  value={makeNote}
                  onChange={(e) => setMakeNote(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Shortage alert */}
            {makeShortages.length > 0 && (
              <div className="p-3 bg-danger/10 border border-danger/30 rounded-md text-danger space-y-1">
                <div className="font-semibold flex items-center gap-1.5 text-xs">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Warning: Raw Material Shortage</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  The following materials will drop below zero stock:
                  {' ' + makeShortages.map((s) => `${s.name} (Short: ${Math.abs(s.stockAfter)} ${s.unit})`).join(', ')}.
                </p>
              </div>
            )}

            {/* Requirements preview table */}
            <div className="border border-border rounded-md overflow-hidden">
              <div className="bg-muted p-2 font-semibold text-[11px] border-b border-border">
                Materials to be Consumed from Stock:
              </div>
              {makeRequirements.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-xs">
                  No recipe found for this product. Define a BOM in the &ldquo;Bill of Materials&rdquo; tab first.
                </div>
              ) : (
                <table className="w-full text-[11px] text-left">
                  <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                    <tr>
                      <th className="p-1.5">Material</th>
                      <th className="p-1.5 text-right">Qty Needed</th>
                      <th className="p-1.5 text-right">Available</th>
                      <th className="p-1.5 text-right">After Run</th>
                      <th className="p-1.5 text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {makeRequirements.map((m) => (
                      <tr key={m.productId} className={m.stockAfter < 0 ? 'bg-danger/5' : ''}>
                        <td className="p-1.5 font-medium">{m.name}</td>
                        <td className="p-1.5 text-right">{m.qtyUsed} {m.unit}</td>
                        <td className="p-1.5 text-right text-muted-foreground">{m.stockBefore} {m.unit}</td>
                        <td className={`p-1.5 text-right font-semibold ${m.stockAfter < 0 ? 'text-danger' : 'text-success'}`}>
                          {m.stockAfter} {m.unit}
                        </td>
                        <td className="p-1.5 text-right">{rupees(m.cost.toFixed(2))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" onClick={() => setMakeModalOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmMake}
                disabled={submittingMake || makeRequirements.length === 0}
              >
                {submittingMake ? 'Recording...' : 'Confirm Production Run'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ===================== VIEW BATCH DETAILS MODAL ===================== */}
      {viewBatch && (
        <Modal
          open={true}
          title={`Batch Details: ${viewBatch.productName}`}
          onClose={() => setViewBatch(null)}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 rounded-md">
              <div>
                <span className="text-muted-foreground">Batch ID:</span>{' '}
                <span className="font-mono">{viewBatch.id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Date:</span> {viewBatch.productionDate}
              </div>
              <div>
                <span className="text-muted-foreground">Quantity Manufactured:</span>{' '}
                <span className="font-semibold">{viewBatch.quantity} {viewBatch.unit}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Material Cost:</span>{' '}
                <span className="font-semibold text-accent">{rupees(viewBatch.costRupees)}</span>
              </div>
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <div className="bg-muted p-2 font-semibold text-[11px] border-b border-border">
                Materials Consumed:
              </div>
              <table className="w-full text-xs text-left">
                <thead className="bg-muted/50 border-b border-border text-muted-foreground">
                  <tr>
                    <th className="p-2">Material</th>
                    <th className="p-2 text-right">Qty Used</th>
                    <th className="p-2 text-right">Unit Rate</th>
                    <th className="p-2 text-right">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {viewBatch.materials.map((m, i) => (
                    <tr key={i}>
                      <td className="p-2 font-medium">{m.name}</td>
                      <td className="p-2 text-right">{m.qtyUsed} {m.unit}</td>
                      <td className="p-2 text-right">{rupees((m.rate || 0).toFixed(2))}</td>
                      <td className="p-2 text-right font-medium">{rupees(m.cost.toFixed(2))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => setViewBatch(null)}>
                Close
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
