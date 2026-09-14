import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus } from "lucide-react";
import { api, ApiError } from "../api/client";
import { MenuCategory, MenuItem, PriceType } from "../api/types";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { costPerDisplayUnit, displayUnitFor, formatQty } from "../utils/units";
import { Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

/** The real label for a price type — "Half"/"Full" for portions, but an
 * item can override these (e.g. momo uses "5 pc"/"8 pc" instead). */
function priceLabelFor(item: Pick<MenuItem, "half_label" | "full_label">, priceType: PriceType): string {
  if (priceType === "HALF") return item.half_label;
  if (priceType === "FULL") return item.full_label;
  return "Price";
}

export function Menu() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["menu"], queryFn: () => api.get<{ categories: MenuCategory[] }>("/menu") });
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [viewing, setViewing] = useState<{ item: MenuItem; categoryName: string } | null>(null);
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newItemCategory, setNewItemCategory] = useState<MenuCategory | null>(null);

  const categories = (data?.categories ?? []).filter((c) => c.name !== "System");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["menu"] });

  return (
    <div>
      <PageHeader
        title="Menu"
        description="Prices are editable by Admin. Changing a price never affects past orders."
        actions={isAdmin && <Button onClick={() => setNewCategoryOpen(true)}>+ New Category</Button>}
      />
      <div className="space-y-8">
        {categories.map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">{cat.name}</h2>
              {isAdmin && (
                <button
                  onClick={() => setNewItemCategory(cat)}
                  className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  <Plus size={13} /> Add item
                </button>
              )}
            </div>
            {cat.items.length === 0 ? (
              <p className="text-sm text-slate-400">No items yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cat.items.map((item) => (
                  <button
                    key={item.id}
                    className="text-left w-full"
                    onClick={() => setViewing({ item, categoryName: cat.name })}
                  >
                    <Card className="p-3 hover:border-brand-300 hover:shadow-md transition-shadow">
                      <div className="font-medium text-sm text-slate-800 truncate">{item.name}</div>
                      <div className="text-xs text-slate-500 space-x-2 mt-0.5">
                        {item.prices.map((p) => (
                          <span key={p.price_type}>
                            {priceLabelFor(item, p.price_type)}: {formatPaise(p.price_paise)}
                          </span>
                        ))}
                        {item.prices.length === 0 && <span className="text-amber-600">No price set</span>}
                      </div>
                      {item.status !== "ACTIVE" && (
                        <Badge tone={item.status === "UNAVAILABLE" ? "yellow" : "red"}>{item.status}</Badge>
                      )}
                    </Card>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <EditItemModal item={editing} onClose={() => setEditing(null)} onSaved={() => queryClient.invalidateQueries({ queryKey: ["menu"] })} />
      <DetailModal
        item={viewing?.item ?? null}
        categoryName={viewing?.categoryName ?? ""}
        onClose={() => setViewing(null)}
        canSeeCost={user?.role === "ADMIN" || user?.role === "MANAGER"}
        onEdit={
          isAdmin
            ? (item) => {
                setViewing(null);
                setEditing(item);
              }
            : undefined
        }
      />

      <NewCategoryModal open={newCategoryOpen} onClose={() => setNewCategoryOpen(false)} onSaved={invalidate} nextSortOrder={categories.length} />
      <NewItemModal category={newItemCategory} onClose={() => setNewItemCategory(null)} onSaved={invalidate} />
    </div>
  );
}

interface RecipeCostLine {
  inventoryItemName: string;
  baseUnit: string;
  quantityBaseNeeded: number;
  unitCostPaisePerBase: number;
  costPaise: number;
}

function RecipeCostSection({ menuItemId, priceType, label, pricePaise }: { menuItemId: string; priceType: string; label: string; pricePaise: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ["recipe", menuItemId, priceType],
    queryFn: () => api.get<{ version: unknown; cost: { totalCostPaise: number; lines: RecipeCostLine[] } | null }>(`/recipes/${menuItemId}/${priceType}`),
  });

  if (isLoading) return <div className="text-xs text-slate-400">Loading {label} recipe…</div>;

  const cost = data?.cost;
  if (!cost || !data?.version) {
    return (
      <div className="border border-dashed border-slate-200 rounded-lg p-3">
        <div className="text-xs font-semibold text-slate-600 mb-1">{label}</div>
        <p className="text-xs text-amber-600">No recipe configured — COGS shows as unavailable for this sale until an Admin adds one.</p>
      </div>
    );
  }

  const foodCostPct = pricePaise > 0 ? (cost.totalCostPaise / pricePaise) * 100 : 0;
  const grossProfit = pricePaise - cost.totalCostPaise;

  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-semibold text-slate-600 mb-2">{label}</div>
      <div className="space-y-1 mb-2">
        {cost.lines.map((line, idx) => (
          <div key={idx} className="flex justify-between text-xs text-slate-500">
            <span>
              {line.inventoryItemName} ({formatQty(line.quantityBaseNeeded, line.baseUnit)} @{" "}
              {formatPaise(costPerDisplayUnit(line.unitCostPaisePerBase, line.baseUnit))}/{displayUnitFor(line.baseUnit)})
            </span>
            <span className="tabular-nums">{formatPaise(line.costPaise)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs font-medium border-t border-slate-100 pt-1.5">
        <span>Total COGS</span>
        <span className="tabular-nums">{formatPaise(cost.totalCostPaise)}</span>
      </div>
      <div className="flex justify-between text-xs text-emerald-600">
        <span>Gross profit</span>
        <span className="tabular-nums">{formatPaise(grossProfit)}</span>
      </div>
      <div className="flex justify-between text-xs text-slate-400">
        <span>Food cost %</span>
        <span className="tabular-nums">{foodCostPct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

function DetailModal({
  item,
  categoryName,
  onClose,
  canSeeCost,
  onEdit,
}: {
  item: MenuItem | null;
  categoryName: string;
  onClose: () => void;
  canSeeCost: boolean;
  onEdit?: (item: MenuItem) => void;
}) {
  if (!item) return null;

  return (
    <Modal open={!!item} onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {onEdit && (
          <Button size="sm" variant="secondary" onClick={() => onEdit(item)}>
            Edit Prices & Status
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-xs text-slate-400 uppercase">Category</div>
            <div>{categoryName}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase">Unit</div>
            <div>{item.unit_label}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase">Status</div>
            <Badge tone={item.status === "ACTIVE" ? "green" : item.status === "UNAVAILABLE" ? "yellow" : "red"}>{item.status}</Badge>
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Prices</div>
          {item.prices.length === 0 ? (
            <p className="text-sm text-amber-600">No price configured yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {item.prices.map((p) => (
                <div key={p.price_type} className="bg-slate-50 rounded-lg p-2 text-center">
                  <div className="text-[11px] text-slate-500">{priceLabelFor(item, p.price_type)}</div>
                  <div className="font-semibold">{formatPaise(p.price_paise)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {canSeeCost && item.prices.length > 0 && (
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase mb-1.5">Recipe & Cost</div>
            <div className="space-y-2">
              {item.prices.map((p) => (
                <RecipeCostSection key={p.price_type} menuItemId={item.id} priceType={p.price_type} label={priceLabelFor(item, p.price_type)} pricePaise={p.price_paise} />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function EditItemModal({ item, onClose, onSaved }: { item: MenuItem | null; onClose: () => void; onSaved: () => void }) {
  const [half, setHalf] = useState("");
  const [full, setFull] = useState("");
  const [single, setSingle] = useState("");
  const [status, setStatus] = useState("ACTIVE");

  useEffect(() => {
    if (item) {
      setHalf(((item.prices.find((p) => p.price_type === "HALF")?.price_paise ?? 0) / 100).toString());
      setFull(((item.prices.find((p) => p.price_type === "FULL")?.price_paise ?? 0) / 100).toString());
      setSingle(((item.prices.find((p) => p.price_type === "SINGLE")?.price_paise ?? 0) / 100).toString());
      setStatus(item.status);
    }
  }, [item]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/menu/${item!.id}`, {
        status,
        halfPricePaise: item!.has_half ? rupeesToPaise(parseFloat(half) || 0) : undefined,
        fullPricePaise: item!.has_full ? rupeesToPaise(parseFloat(full) || 0) : undefined,
        singlePricePaise: item!.has_single ? rupeesToPaise(parseFloat(single) || 0) : undefined,
      }),
    onSuccess: () => {
      toast.success("Menu item updated");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update item"),
  });

  if (!item) return null;

  return (
    <Modal open={!!item} onClose={onClose} title={`Edit ${item.name}`}>
      <div className="space-y-3">
        {!!item.has_half && (
          <div>
            <label className="text-xs font-medium text-slate-500">{item.half_label} price (₹)</label>
            <Input type="number" value={half} onChange={(e) => setHalf(e.target.value)} className="w-full" />
          </div>
        )}
        {!!item.has_full && (
          <div>
            <label className="text-xs font-medium text-slate-500">{item.full_label} price (₹)</label>
            <Input type="number" value={full} onChange={(e) => setFull(e.target.value)} className="w-full" />
          </div>
        )}
        {!!item.has_single && (
          <div>
            <label className="text-xs font-medium text-slate-500">Price (₹)</label>
            <Input type="number" value={single} onChange={(e) => setSingle(e.target.value)} className="w-full" />
          </div>
        )}
        <div>
          <label className="text-xs font-medium text-slate-500">Status</label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full">
            <option value="ACTIVE">Active</option>
            <option value="UNAVAILABLE">Temporarily unavailable</option>
            <option value="DISCONTINUED">Discontinued</option>
          </Select>
        </div>
        <Button className="w-full" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </Modal>
  );
}

/** New categories start empty on purpose — e.g. a "Beverages" section — and
 * get real items added one at a time via NewItemModal, so nothing here ever
 * invents a name or a price on the owner's behalf. */
function NewCategoryModal({
  open,
  onClose,
  onSaved,
  nextSortOrder,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  nextSortOrder: number;
}) {
  const [name, setName] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.post("/menu/categories", { name, sortOrder: nextSortOrder }),
    onSuccess: () => {
      toast.success(`"${name}" category added`);
      setName("");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create category"),
  });

  return (
    <Modal open={open} onClose={onClose} title="New Menu Category">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">Category name</label>
          <Input placeholder="e.g. Beverages" value={name} onChange={(e) => setName(e.target.value)} className="w-full" autoFocus />
        </div>
        <Button className="w-full" disabled={!name.trim() || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Creating…" : "Create Category"}
        </Button>
      </div>
    </Modal>
  );
}

type NewItemPricing = "PORTIONS" | "SINGLE";

/** Covers the two real pricing shapes already used across the menu: portion
 * items (Half/Full, or repurposed for piece-counts like Momo's "5 pc"/"8 pc")
 * and flat single-price items (Rolls, Breads, Extras — and most beverages). */
function NewItemModal({ category, onClose, onSaved }: { category: MenuCategory | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [pricing, setPricing] = useState<NewItemPricing>("SINGLE");
  const [unitLabel, setUnitLabel] = useState("plate");
  const [halfLabel, setHalfLabel] = useState("Half");
  const [fullLabel, setFullLabel] = useState("Full");
  const [halfPrice, setHalfPrice] = useState("");
  const [fullPrice, setFullPrice] = useState("");
  const [singlePrice, setSinglePrice] = useState("");

  useEffect(() => {
    if (category) {
      setName("");
      setPricing("SINGLE");
      setUnitLabel("plate");
      setHalfLabel("Half");
      setFullLabel("Full");
      setHalfPrice("");
      setFullPrice("");
      setSinglePrice("");
    }
  }, [category]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/menu", {
        categoryId: category!.id,
        name,
        hasHalf: pricing === "PORTIONS",
        hasFull: pricing === "PORTIONS",
        hasSingle: pricing === "SINGLE",
        unitLabel,
        halfLabel: pricing === "PORTIONS" ? halfLabel : undefined,
        fullLabel: pricing === "PORTIONS" ? fullLabel : undefined,
        halfPricePaise: pricing === "PORTIONS" ? rupeesToPaise(parseFloat(halfPrice) || 0) : undefined,
        fullPricePaise: pricing === "PORTIONS" ? rupeesToPaise(parseFloat(fullPrice) || 0) : undefined,
        singlePricePaise: pricing === "SINGLE" ? rupeesToPaise(parseFloat(singlePrice) || 0) : undefined,
      }),
    onSuccess: () => {
      toast.success(`"${name}" added to ${category!.name}`);
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create item"),
  });

  if (!category) return null;

  const valid =
    name.trim().length > 0 &&
    (pricing === "SINGLE" ? parseFloat(singlePrice) > 0 : parseFloat(halfPrice) > 0 && parseFloat(fullPrice) > 0);

  return (
    <Modal open={!!category} onClose={onClose} title={`New Item — ${category.name}`}>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">Item name</label>
          <Input placeholder="e.g. Sweet Lassi" value={name} onChange={(e) => setName(e.target.value)} className="w-full" autoFocus />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Pricing</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setPricing("SINGLE")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg ${pricing === "SINGLE" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Single price
            </button>
            <button
              onClick={() => setPricing("PORTIONS")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg ${pricing === "PORTIONS" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Half / Full
            </button>
          </div>
        </div>

        {pricing === "SINGLE" ? (
          <div>
            <label className="text-xs font-medium text-slate-500">Price (₹)</label>
            <Input type="number" min={0} value={singlePrice} onChange={(e) => setSinglePrice(e.target.value)} className="w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Label</label>
              <Input value={halfLabel} onChange={(e) => setHalfLabel(e.target.value)} className="w-full" placeholder="Half" />
              <Input
                type="number"
                min={0}
                value={halfPrice}
                onChange={(e) => setHalfPrice(e.target.value)}
                className="w-full mt-1.5"
                placeholder="Price ₹"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Label</label>
              <Input value={fullLabel} onChange={(e) => setFullLabel(e.target.value)} className="w-full" placeholder="Full" />
              <Input
                type="number"
                min={0}
                value={fullPrice}
                onChange={(e) => setFullPrice(e.target.value)}
                className="w-full mt-1.5"
                placeholder="Price ₹"
              />
            </div>
          </div>
        )}

        <div>
          <label className="text-xs font-medium text-slate-500">Unit (shown on the bill, e.g. "plate", "glass", "bottle")</label>
          <Input value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)} className="w-full" />
        </div>

        <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Adding…" : "Add Item"}
        </Button>
      </div>
    </Modal>
  );
}
