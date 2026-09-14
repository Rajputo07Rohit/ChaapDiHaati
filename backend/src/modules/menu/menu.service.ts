import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
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

const currentPricesStmt = db.prepare(
  "SELECT price_type, price_paise FROM menu_prices WHERE menu_item_id = ? AND effective_to IS NULL"
);

export function getCurrentPrices(menuItemId: string): CurrentPriceRow[] {
  return currentPricesStmt.all(menuItemId) as CurrentPriceRow[];
}

export function getCurrentPrice(menuItemId: string, priceType: PriceType): number | null {
  const row = db
    .prepare("SELECT price_paise FROM menu_prices WHERE menu_item_id = ? AND price_type = ? AND effective_to IS NULL")
    .get(menuItemId, priceType) as { price_paise: number } | undefined;
  return row?.price_paise ?? null;
}

export function getPriceAt(menuItemId: string, priceType: PriceType, atIso: string): number | null {
  const row = db
    .prepare(
      `SELECT price_paise FROM menu_prices
       WHERE menu_item_id = ? AND price_type = ? AND effective_from <= ?
         AND (effective_to IS NULL OR effective_to > ?)
       ORDER BY effective_from DESC LIMIT 1`
    )
    .get(menuItemId, priceType, atIso, atIso) as { price_paise: number } | undefined;
  return row?.price_paise ?? null;
}

/**
 * Sets a new price for a menu item, closing out the previous price row so
 * historical orders keep referencing the price that was effective at sale
 * time (RULE 5: historical prices are never rewritten).
 */
export function setMenuPrice(
  menuItemId: string,
  priceType: PriceType,
  newPricePaise: number,
  userId: string
): void {
  if (newPricePaise < 0) throw new ValidationError("Price cannot be negative.");
  const now = nowIso();

  const txn = db.transaction(() => {
    const previous = db
      .prepare("SELECT * FROM menu_prices WHERE menu_item_id = ? AND price_type = ? AND effective_to IS NULL")
      .get(menuItemId, priceType) as { id: string; price_paise: number } | undefined;

    if (previous) {
      db.prepare("UPDATE menu_prices SET effective_to = ? WHERE id = ?").run(now, previous.id);
    }

    db.prepare(
      `INSERT INTO menu_prices (id, menu_item_id, price_type, price_paise, effective_from, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(newId("price"), menuItemId, priceType, newPricePaise, now, userId, now);

    recordAudit({
      userId,
      action: "MENU_PRICE_CHANGED",
      entityType: "menu_item",
      entityId: menuItemId,
      oldValue: previous ? { priceType, pricePaise: previous.price_paise } : null,
      newValue: { priceType, pricePaise: newPricePaise },
    });
  });

  txn();
}

export function getMenuItemOrThrow(id: string): MenuItemRow {
  const row = db.prepare("SELECT * FROM menu_items WHERE id = ?").get(id) as MenuItemRow | undefined;
  if (!row) throw new NotFoundError("Menu item");
  return row;
}

export function listMenu() {
  const categories = db
    .prepare("SELECT * FROM menu_categories WHERE active = 1 ORDER BY sort_order ASC")
    .all() as { id: string; name: string; sort_order: number }[];

  const items = db
    .prepare("SELECT * FROM menu_items WHERE status != 'DISCONTINUED' ORDER BY sort_order ASC")
    .all() as MenuItemRow[];

  return categories.map((cat) => ({
    ...cat,
    items: items
      .filter((i) => i.category_id === cat.id)
      .map((i) => ({ ...i, prices: getCurrentPrices(i.id) })),
  }));
}
