import bcrypt from "bcryptjs";
import { db } from "../src/db/connection";
import { newId, nowIso } from "../src/utils/ids";
import { setMenuPrice } from "../src/modules/menu/menu.service";

export function ensureRoles() {
  for (const [name, description] of [
    ["ADMIN", "x"],
    ["MANAGER", "x"],
    ["STAFF", "x"],
  ]) {
    db.prepare("INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)").run(name, description);
  }
}

export function makeUser(role: "ADMIN" | "MANAGER" | "STAFF" = "ADMIN"): string {
  ensureRoles();
  const id = newId("user");
  const now = nowIso();
  db.prepare(
    "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
  ).run(id, `${role.toLowerCase()}_${id.slice(-6)}`, bcrypt.hashSync("x", 4), `${role} Test User`, role, now, now);
  return id;
}

export function makePaymentMethod(type: "CASH" | "ONLINE" = "CASH"): string {
  const id = newId("pm");
  db.prepare("INSERT INTO payment_methods (id, name, type, active, sort_order) VALUES (?, ?, ?, 1, 0)").run(
    id,
    `${type}_${id.slice(-6)}`,
    type
  );
  return id;
}

export function makeCategory(): string {
  const id = newId("cat");
  db.prepare("INSERT INTO menu_categories (id, name, sort_order, active) VALUES (?, ?, 0, 1)").run(id, `cat_${id.slice(-6)}`);
  return id;
}

export function makeInventoryItem(opts: { openingQtyBase?: number; costPaisePerBase?: number } = {}): string {
  const id = newId("inv");
  db.prepare(
    `INSERT INTO inventory_items
      (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base, min_stock_base,
       reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
     VALUES (?, ?, 'RAW_MATERIAL', 'g', 'kg', 1000, ?, 0, 0, ?, 0, 1, ?)`
  ).run(id, `item_${id.slice(-6)}`, opts.openingQtyBase ?? 0, opts.costPaisePerBase ?? 0, nowIso());
  return id;
}

export function makeMenuItemWithRecipe(opts: {
  priceType: "HALF" | "FULL" | "SINGLE";
  pricePaise: number;
  ingredientQtyBase: number;
  ingredientCostPaisePerBase: number;
  userId: string;
}): { menuItemId: string; inventoryItemId: string } {
  const categoryId = makeCategory();
  const menuItemId = newId("menuitem");
  db.prepare(
    `INSERT INTO menu_items (id, category_id, name, has_half, has_full, has_single, unit_label, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'plate', 'ACTIVE', ?)`
  ).run(
    menuItemId,
    categoryId,
    `menu_${menuItemId.slice(-6)}`,
    opts.priceType === "HALF" ? 1 : 0,
    opts.priceType === "FULL" ? 1 : 0,
    opts.priceType === "SINGLE" ? 1 : 0,
    nowIso()
  );

  setMenuPrice(menuItemId, opts.priceType, opts.pricePaise, opts.userId);

  const inventoryItemId = makeInventoryItem({ openingQtyBase: 1_000_000, costPaisePerBase: opts.ingredientCostPaisePerBase });

  const versionId = newId("recipe");
  db.prepare(
    `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, created_by, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?)`
  ).run(versionId, menuItemId, opts.priceType, nowIso(), opts.userId, nowIso());
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, ?, 0, 100, 0)`
  ).run(newId("ritem"), versionId, inventoryItemId, opts.ingredientQtyBase);

  return { menuItemId, inventoryItemId };
}

export function getInventoryItem(id: string) {
  return db.prepare("SELECT * FROM inventory_items WHERE id = ?").get(id) as any;
}
