import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { InventoryItem } from "../api/types";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { costPerBaseFromDisplay, costPerDisplayUnit, displayUnitFor, formatQty, formatQtyShort, toBaseFromDisplay } from "../utils/units";
import { ActionMenu, Badge, Button, Card, Input, Modal, PageHeader, Select, StockBadge } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = ["RAW_MATERIAL", "PACKAGING", "DISPOSABLE", "OTHER"];
const ADJUST_REASONS = ["WASTE", "SPOILAGE", "DAMAGE", "STOCK_ADJUSTMENT"];

export function Inventory() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const isManagerUp = isAdmin || user?.role === "MANAGER";
  const queryClient = useQueryClient();
  const [category, setCategory] = useState("");
  const [addStockTarget, setAddStockTarget] = useState<InventoryItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<InventoryItem | null>(null);
  const [setCostTarget, setSetCostTarget] = useState<InventoryItem | null>(null);
  const [editTarget, setEditTarget] = useState<InventoryItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InventoryItem | null>(null);
  const [countMode, setCountMode] = useState(false);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["inventory"] });

  const reactivateMutation = useMutation({
    mutationFn: (item: InventoryItem) => api.patch(`/inventory/${item.id}`, { active: true }),
    onSuccess: (_res, item) => {
      toast.success(`${item.name} reactivated`);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reactivate item"),
  });
  const reactivate = (item: InventoryItem) => reactivateMutation.mutate(item);

  const { data, isLoading } = useQuery({
    queryKey: ["inventory", category, showInactive],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category) params.set("category", category);
      if (!showInactive) params.set("active", "true");
      const qs = params.toString();
      return api.get<{ items: InventoryItem[] }>(`/inventory${qs ? `?${qs}` : ""}`);
    },
  });

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Stock is calculated from movements — purchases, consumption, waste, and counts. It is never overwritten directly."
        actions={
          <>
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </Select>
            <label className="flex items-center gap-1.5 text-sm text-slate-500 px-1">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            {isManagerUp && (
              <Button variant="secondary" onClick={() => setCountMode(true)}>
                Start Stock Count
              </Button>
            )}
            {isAdmin && <Button onClick={() => setNewItemOpen(true)}>+ New Item</Button>}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Item</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-right px-4 py-2.5">Qty</th>
                <th className="text-right px-4 py-2.5">Avg Cost</th>
                <th className="text-right px-4 py-2.5">Value</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.items ?? []).map((item) => (
                <tr key={item.id} className={`hover:bg-slate-50 ${!item.active ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 font-medium">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span>{item.name}</span>
                      {!item.active && <Badge tone="gray">Inactive</Badge>}
                      {!!item.price_pending && <Badge tone="yellow">PRICE PENDING</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{item.category.replace("_", " ")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatQtyShort(item.current_qty_base, item.base_unit)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {item.price_pending
                      ? "—"
                      : `${formatPaise(costPerDisplayUnit(item.avg_cost_paise_per_base, item.base_unit))}/${displayUnitFor(item.base_unit)}`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(item.current_qty_base * item.avg_cost_paise_per_base)}</td>
                  <td className="px-4 py-2.5">
                    <StockBadge status={item.stockStatus} />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {isManagerUp && (
                        <Button size="sm" onClick={() => setAddStockTarget(item)}>
                          + Add Stock
                        </Button>
                      )}
                      <ActionMenu
                        items={[
                          { label: "Adjust (waste/damage)", onClick: () => setAdjustTarget(item), hidden: !isManagerUp },
                          { label: item.price_pending ? "Set Cost" : "Edit Cost", onClick: () => setSetCostTarget(item), hidden: !isAdmin },
                          { label: "Edit Details", onClick: () => setEditTarget(item), hidden: !isAdmin },
                          {
                            label: item.active ? "Delete" : "Reactivate",
                            onClick: () => (item.active ? setDeleteTarget(item) : reactivate(item)),
                            tone: item.active ? "danger" : "default",
                            hidden: !isAdmin,
                          },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.items.length ?? 0) === 0 && <p className="text-center text-slate-400 py-8">No items in this category.</p>}
        </div>
      </Card>

      <AddStockModal
        item={addStockTarget}
        onClose={() => setAddStockTarget(null)}
        onSaved={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })}
      />
      <AdjustModal item={adjustTarget} onClose={() => setAdjustTarget(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })} />
      <SetCostModal item={setCostTarget} onClose={() => setSetCostTarget(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })} />
      <EditItemModal item={editTarget} onClose={() => setEditTarget(null)} onSaved={invalidate} />
      <DeleteItemModal item={deleteTarget} onClose={() => setDeleteTarget(null)} onSaved={invalidate} />
      {countMode && <StockCountFlow onClose={() => setCountMode(false)} />}
      <NewItemModal open={newItemOpen} onClose={() => setNewItemOpen(false)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["inventory"] })} />
    </div>
  );
}

/** The obvious, day-to-day way to record stock coming in without a full Purchase
 * entry (e.g. a physical count you're now confident about, a delivery with no bill
 * yet). Quantity is typed in the item's natural unit (kg/L/piece), not raw grams. */
function AddStockModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const costNum = parseFloat(cost);
      return api.post("/inventory/adjust", {
        inventoryItemId: item!.id,
        direction: "IN",
        movementType: "STOCK_ADJUSTMENT",
        quantityBase: toBaseFromDisplay(parseFloat(quantity), item!.base_unit),
        unitCostPaisePerBase: !isNaN(costNum) && costNum > 0 ? costPerBaseFromDisplay(rupeesToPaise(costNum), item!.base_unit) : undefined,
        reason: note || "Stock added",
      });
    },
    onSuccess: () => {
      toast.success(`Stock added to ${item!.name}`);
      onSaved();
      onClose();
      setQuantity("");
      setCost("");
      setNote("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not add stock"),
  });

  if (!item) return null;
  const unit = displayUnitFor(item.base_unit);

  return (
    <Modal open={!!item} onClose={onClose} title={`Add Stock — ${item.name}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">Current stock: {formatQty(item.current_qty_base, item.base_unit)}</p>
        <div>
          <label className="text-xs font-medium text-slate-500">Quantity to add ({unit})</label>
          <Input type="number" min={0} step="any" autoFocus value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-full" />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Cost per {unit} (₹, optional — if you know it)</label>
          <Input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} className="w-full" />
        </div>
        <Input placeholder="Note (optional — e.g. delivery, count correction)" value={note} onChange={(e) => setNote(e.target.value)} className="w-full" />
        {item.price_pending && !cost && (
          <p className="text-xs text-amber-600">
            No cost entered — this will stay PRICE PENDING. Enter a cost above if you know it, or set it later from the PRICE PENDING badge.
          </p>
        )}
        <Button className="w-full" disabled={!quantity || parseFloat(quantity) <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Adding…" : `Add ${quantity || "0"} ${unit}`}
        </Button>
      </div>
    </Modal>
  );
}

/** Declares the cost of stock that's already on hand (e.g. added via Add
 * Stock with no price at the time). No quantity changes — this only sets
 * the cost basis, so it requires Admin and always asks why. */
function SetCostModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/inventory/${item!.id}/set-cost`, {
        costPaisePerBase: costPerBaseFromDisplay(rupeesToPaise(parseFloat(cost)), item!.base_unit),
        reason,
      }),
    onSuccess: () => {
      toast.success(`Cost set for ${item!.name}`);
      onSaved();
      onClose();
      setCost("");
      setReason("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not set cost"),
  });

  if (!item) return null;
  const unit = displayUnitFor(item.base_unit);
  const costNum = parseFloat(cost) || 0;
  const totalValue = costNum * (item.current_qty_base / toBaseFromDisplay(1, item.base_unit));

  return (
    <Modal open={!!item} onClose={onClose} title={`Set Cost — ${item.name}`}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">
          On hand: {formatQty(item.current_qty_base, item.base_unit)} — this only declares its cost, it does not add or remove any quantity.
        </p>
        <div>
          <label className="text-xs font-medium text-slate-500">Cost per {unit} (₹)</label>
          <Input type="number" min={0} step="any" autoFocus value={cost} onChange={(e) => setCost(e.target.value)} className="w-full" />
        </div>
        {cost && <p className="text-xs text-slate-500">Stock on hand would then be worth ≈ {formatPaise(rupeesToPaise(totalValue))}</p>}
        <Input placeholder="Reason (required — e.g. known market rate, first purchase pending bill)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
        <Button className="w-full" disabled={!cost || costNum <= 0 || !reason || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Set Cost"}
        </Button>
      </div>
    </Modal>
  );
}

function AdjustModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [direction, setDirection] = useState<"IN" | "OUT">("OUT");
  const [movementType, setMovementType] = useState("WASTE");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/inventory/adjust", {
        inventoryItemId: item!.id,
        direction,
        movementType,
        quantityBase: parseFloat(quantity),
        reason,
      }),
    onSuccess: () => {
      toast.success("Stock adjusted");
      onSaved();
      onClose();
      setQuantity("");
      setReason("");
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not adjust stock"),
  });

  if (!item) return null;

  return (
    <Modal open={!!item} onClose={onClose} title={`Adjust — ${item.name}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Select value={movementType} onChange={(e) => setMovementType(e.target.value)}>
            {ADJUST_REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "IN" | "OUT")}>
            <option value="OUT">Reduce stock</option>
            <option value="IN">Increase stock</option>
          </Select>
        </div>
        <Input
          type="number"
          placeholder={`Quantity (in ${item.base_unit === "g" ? "grams" : item.base_unit === "ml" ? "ml" : "pieces"})`}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="w-full"
        />
        <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" />
        <p className="text-xs text-slate-400">Current stock: {formatQty(item.current_qty_base, item.base_unit)}</p>
        <Button className="w-full" disabled={!quantity || !reason || mutation.isPending} onClick={() => mutation.mutate()}>
          Save Adjustment
        </Button>
      </div>
    </Modal>
  );
}

/** Corrects the item's own details — name, category, or how its purchase
 * unit converts to base units. Never touches quantity or cost, so it's
 * always safe: past movements stay exactly as recorded. */
function EditItemModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("RAW_MATERIAL");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [minStock, setMinStock] = useState("");
  const [reorderLevel, setReorderLevel] = useState("");

  useEffect(() => {
    if (item) {
      setName(item.name);
      setCategory(item.category);
      setPurchaseUnit(item.purchase_unit);
      setFactor(item.purchase_to_base_factor.toString());
      setMinStock(item.min_stock_base.toString());
      setReorderLevel(item.reorder_level_base.toString());
    }
  }, [item]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/inventory/${item!.id}`, {
        name,
        category,
        purchaseUnit,
        purchaseToBaseFactor: parseFloat(factor) || undefined,
        minStockBase: parseFloat(minStock) || 0,
        reorderLevelBase: parseFloat(reorderLevel) || 0,
      }),
    onSuccess: () => {
      toast.success("Item updated");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update item"),
  });

  if (!item) return null;

  return (
    <Modal open={!!item} onClose={onClose} title={`Edit — ${item.name}`}>
      <div className="space-y-3">
        <Input value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
        <div className="grid grid-cols-2 gap-2">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </Select>
          <Input placeholder="Purchase unit (kg, packet…)" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">
            1 {purchaseUnit || "unit"} = how many {item.base_unit === "piece" ? "pieces" : item.base_unit}?
          </label>
          <Input type="number" min={0} value={factor} onChange={(e) => setFactor(e.target.value)} className="w-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">Minimum stock ({item.base_unit})</label>
            <Input type="number" min={0} value={minStock} onChange={(e) => setMinStock(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Reorder level ({item.base_unit})</label>
            <Input type="number" min={0} value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} className="w-full" />
          </div>
        </div>
        <Button className="w-full" disabled={!name || !purchaseUnit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </Modal>
  );
}

/** "Delete" is only ever a true permanent delete when the item has zero
 * history (never purchased, never sold, never counted) — the backend
 * decides that safely and falls back to deactivating otherwise, so the
 * confirmation here doesn't need to ask the user to know the difference. */
function DeleteItemModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const mutation = useMutation({
    mutationFn: () => api.delete<{ deleted: boolean; deactivated: boolean; reason?: string }>(`/inventory/${item!.id}`),
    onSuccess: (res) => {
      toast.success(res.deleted ? `${item!.name} deleted` : `${item!.name} hidden — ${res.reason ?? "it has history and was kept for records"}`);
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete item"),
  });

  if (!item) return null;

  return (
    <Modal open={!!item} onClose={onClose} title={`Delete ${item.name}?`}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          If this item has never been purchased, sold, or counted, it will be removed for good. If it already has real stock history, it'll be
          hidden from your list instead so that history is never lost — you can bring it back later from "Show inactive".
        </p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" className="flex-1" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Working…" : "Delete"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function StockCountFlow({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [countId, setCountId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [physical, setPhysical] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const startMutation = useMutation({
    mutationFn: () => api.post<{ count: { id: string }; items: any[] }>("/inventory/counts", {}),
    onSuccess: (res) => {
      setCountId(res.count.id);
      setItems(res.items);
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not start count"),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post(`/inventory/counts/${countId}/submit`, {
        lines: items
          .filter((i) => physical[i.inventory_item_id] !== undefined && physical[i.inventory_item_id] !== "")
          .map((i) => ({
            inventoryItemId: i.inventory_item_id,
            physicalQtyBase: parseFloat(physical[i.inventory_item_id]),
            reason: reasons[i.inventory_item_id] || undefined,
          })),
      }),
    onSuccess: () => {
      toast.success("Stock count completed");
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not submit count. Differences require a reason."),
  });

  return (
    <Modal open onClose={onClose} title="Physical Stock Count" wide>
      {!countId ? (
        <div className="text-center py-6">
          <p className="text-sm text-slate-500 mb-4">This snapshots the system quantity for every active item so you can count physical stock against it.</p>
          <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
            Start Count
          </Button>
        </div>
      ) : (
        <div>
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-slate-100">
            {items.map((line) => (
              <div key={line.inventory_item_id} className="grid grid-cols-4 gap-2 items-center py-2 text-sm">
                <span className="col-span-1 font-medium">{line.item_name}</span>
                <span className="text-slate-400 text-xs">System: {formatQty(line.system_qty_base, line.base_unit)}</span>
                <Input
                  type="number"
                  placeholder="Physical qty"
                  value={physical[line.inventory_item_id] ?? ""}
                  onChange={(e) => setPhysical((p) => ({ ...p, [line.inventory_item_id]: e.target.value }))}
                />
                <Select
                  value={reasons[line.inventory_item_id] ?? ""}
                  onChange={(e) => setReasons((r) => ({ ...r, [line.inventory_item_id]: e.target.value }))}
                >
                  <option value="">Reason if different</option>
                  <option value="WASTE">Waste</option>
                  <option value="SPILLAGE">Spillage</option>
                  <option value="UNRECORDED_CONSUMPTION">Unrecorded consumption</option>
                  <option value="THEFT">Theft</option>
                  <option value="COUNTING_ERROR">Counting error</option>
                  <option value="OTHER">Other</option>
                </Select>
              </div>
            ))}
          </div>
          <Button className="w-full mt-4" onClick={() => submitMutation.mutate()} disabled={submitMutation.isPending}>
            Submit Count
          </Button>
        </div>
      )}
    </Modal>
  );
}

function NewItemModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("RAW_MATERIAL");
  const [baseUnit, setBaseUnit] = useState<"g" | "ml" | "piece">("g");
  const [purchaseUnit, setPurchaseUnit] = useState("kg");
  const [factor, setFactor] = useState("1000");
  const [openingQty, setOpeningQty] = useState("");
  const [openingCost, setOpeningCost] = useState("");
  const [pricePending, setPricePending] = useState(true);

  function reset() {
    setName("");
    setCategory("RAW_MATERIAL");
    setBaseUnit("g");
    setPurchaseUnit("kg");
    setFactor("1000");
    setOpeningQty("");
    setOpeningCost("");
    setPricePending(true);
  }

  const mutation = useMutation({
    mutationFn: () => {
      const f = parseFloat(factor);
      const qtyInPurchaseUnits = parseFloat(openingQty) || 0;
      const costPerPurchaseUnit = parseFloat(openingCost);
      return api.post("/inventory", {
        name,
        category,
        baseUnit,
        purchaseUnit,
        purchaseToBaseFactor: f,
        openingQtyBase: qtyInPurchaseUnits * f,
        openingCostPaisePerBase: !isNaN(costPerPurchaseUnit) && costPerPurchaseUnit > 0 ? rupeesToPaise(costPerPurchaseUnit) / f : undefined,
        pricePending: pricePending || isNaN(costPerPurchaseUnit) || costPerPurchaseUnit <= 0,
      });
    },
    onSuccess: () => {
      toast.success(`${name} added to inventory`);
      onSaved();
      onClose();
      reset();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create item"),
  });

  const factorNum = parseFloat(factor) || 0;

  return (
    <Modal open={open} onClose={onClose} title="New Inventory Item">
      <div className="space-y-3">
        <Input placeholder="Item name (e.g. Frozen Chaap)" value={name} onChange={(e) => setName(e.target.value)} className="w-full" autoFocus />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">Category</label>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace("_", " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Tracked internally as</label>
            <Select value={baseUnit} onChange={(e) => setBaseUnit(e.target.value as "g" | "ml" | "piece")} className="w-full">
              <option value="g">Weight (grams)</option>
              <option value="ml">Volume (ml)</option>
              <option value="piece">Count (pieces)</option>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">You buy it by the</label>
            <Input placeholder="kg, packet, bottle, tin…" value={purchaseUnit} onChange={(e) => setPurchaseUnit(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">
              1 {purchaseUnit || "unit"} = how many {baseUnit === "piece" ? "pieces" : baseUnit}?
            </label>
            <Input type="number" min={0} value={factor} onChange={(e) => setFactor(e.target.value)} className="w-full" />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Opening stock (optional)</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">Quantity ({purchaseUnit || "unit"})</label>
              <Input type="number" min={0} value={openingQty} onChange={(e) => setOpeningQty(e.target.value)} className="w-full" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Cost per {purchaseUnit || "unit"} (₹, optional)</label>
              <Input
                type="number"
                min={0}
                value={openingCost}
                onChange={(e) => {
                  setOpeningCost(e.target.value);
                  setPricePending(!e.target.value);
                }}
                className="w-full"
              />
            </div>
          </div>
          {openingQty && factorNum > 0 && (
            <p className="text-xs text-slate-400 mt-1.5">
              = {formatQty(parseFloat(openingQty) * factorNum || 0, baseUnit)} on hand
              {openingCost && !isNaN(parseFloat(openingCost)) ? "" : " — no cost given, will show as PRICE PENDING"}
            </p>
          )}
        </div>

        <Button className="w-full" disabled={!name || !purchaseUnit || factorNum <= 0 || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Creating…" : "Create Item"}
        </Button>
      </div>
    </Modal>
  );
}
