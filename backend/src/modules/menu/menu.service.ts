import { MenuCategory, MenuItem, MenuItemDoc, MenuPrice } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { NotFoundError, ValidationError } from "../../utils/errors";

export type PriceType = "HALF" | "FULL" | "SINGLE";

export interface MenuItemRow {
  id: string;
  category_id: string;
  name: string;
  has_half: number;
  has_full: number;
  has_single: number;
  unit_label: string;
  half_label: string;
  full_label: string;
  status: "ACTIVE" | "UNAVAILABLE" | "DISCONTINUED";
  sort_order: number;
}

export interface CurrentPriceRow {
  price_type: PriceType;
  price_paise: number;
}

function toItemRow(doc: MenuItemDoc): MenuItemRow {
  return {
    id: doc._id,
    category_id: doc.categoryId,
    name: doc.name,
    has_half: doc.hasHalf ? 1 : 0,
    has_full: doc.hasFull ? 1 : 0,
    has_single: doc.hasSingle ? 1 : 0,
    unit_label: doc.unitLabel,
    half_label: doc.halfLabel,
    full_label: doc.fullLabel,
    status: doc.status,
    sort_order: doc.sortOrder,
  };
}

export async function getCurrentPrices(menuItemId: string): Promise<CurrentPriceRow[]> {
  const docs = await MenuPrice.find({ menuItemId, effectiveTo: null });
  return docs.map((d) => ({ price_type: d.priceType, price_paise: d.pricePaise }));
}

export async function getCurrentPrice(menuItemId: string, priceType: PriceType): Promise<number | null> {
  const row = await MenuPrice.findOne({ menuItemId, priceType, effectiveTo: null });
  return row?.pricePaise ?? null;
}

export async function getPriceAt(menuItemId: string, priceType: PriceType, atIso: string): Promise<number | null> {
  const row = await MenuPrice.findOne({
    menuItemId,
    priceType,
    effectiveFrom: { $lte: atIso },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: atIso } }],
  }).sort({ effectiveFrom: -1 });
  return row?.pricePaise ?? null;
}

/**
 * Sets a new price for a menu item, closing out the previous price row so
 * historical orders keep referencing the price that was effective at sale
 * time (RULE 5: historical prices are never rewritten).
 */
export async function setMenuPrice(menuItemId: string, priceType: PriceType, newPricePaise: number, userId: string): Promise<void> {
  if (newPricePaise < 0) throw new ValidationError("Price cannot be negative.");
  const now = nowIso();

  await withTransaction(async (session) => {
    const previous = await MenuPrice.findOne({ menuItemId, priceType, effectiveTo: null }).session(session);

    if (previous) {
      previous.effectiveTo = now;
      await previous.save({ session });
    }

    await MenuPrice.create(
      [{ _id: newId("price"), menuItemId, priceType, pricePaise: newPricePaise, effectiveFrom: now, createdBy: userId, createdAt: now }],
      { session }
    );

    await recordAudit(
      {
        userId,
        action: "MENU_PRICE_CHANGED",
        entityType: "menu_item",
        entityId: menuItemId,
        oldValue: previous ? { priceType, pricePaise: previous.pricePaise } : null,
        newValue: { priceType, pricePaise: newPricePaise },
      },
      session
    );
  });
}

export async function getMenuItemOrThrow(id: string): Promise<MenuItemRow> {
  const doc = await MenuItem.findById(id);
  if (!doc) throw new NotFoundError("Menu item");
  return toItemRow(doc);
}

export async function listMenu() {
  const categories = await MenuCategory.find({ active: true }).sort({ sortOrder: 1 });
  const items = await MenuItem.find({ status: { $ne: "DISCONTINUED" } }).sort({ sortOrder: 1 });

  const rows = await Promise.all(
    items.map(async (i) => ({ ...toItemRow(i), prices: await getCurrentPrices(i._id) }))
  );

  return categories.map((cat) => ({
    id: cat._id,
    name: cat.name,
    sort_order: cat.sortOrder,
    active: cat.active,
    items: rows.filter((r) => r.category_id === cat._id),
  }));
}

export async function listCategories() {
  const docs = await MenuCategory.find().sort({ sortOrder: 1 });
  return docs.map((c) => ({ id: c._id, name: c.name, sort_order: c.sortOrder, active: c.active }));
}

export async function createCategory(input: { name: string; sortOrder: number }) {
  const id = newId("cat");
  await MenuCategory.create({ _id: id, name: input.name, sortOrder: input.sortOrder, active: true });
  const c = (await MenuCategory.findById(id))!;
  return { id: c._id, name: c.name, sort_order: c.sortOrder, active: c.active };
}

export async function createMenuItem(input: {
  categoryId: string;
  name: string;
  hasHalf?: boolean;
  hasFull?: boolean;
  hasSingle?: boolean;
  unitLabel?: string;
  halfLabel?: string;
  fullLabel?: string;
}): Promise<string> {
  const id = newId("menuitem");
  await MenuItem.create({
    _id: id,
    categoryId: input.categoryId,
    name: input.name,
    hasHalf: !!input.hasHalf,
    hasFull: !!input.hasFull,
    hasSingle: !!input.hasSingle,
    unitLabel: input.unitLabel ?? "plate",
    halfLabel: input.halfLabel ?? "Half",
    fullLabel: input.fullLabel ?? "Full",
    status: "ACTIVE",
    createdAt: nowIso(),
  });
  return id;
}

export async function updateMenuItemFields(
  id: string,
  changes: { name?: string; status?: "ACTIVE" | "UNAVAILABLE" | "DISCONTINUED"; halfLabel?: string; fullLabel?: string }
): Promise<void> {
  const doc = await MenuItem.findById(id);
  if (!doc) throw new NotFoundError("Menu item");
  if (changes.name !== undefined) doc.name = changes.name;
  if (changes.status !== undefined) doc.status = changes.status;
  if (changes.halfLabel !== undefined) doc.halfLabel = changes.halfLabel;
  if (changes.fullLabel !== undefined) doc.fullLabel = changes.fullLabel;
  await doc.save();
}
