import bcrypt from "bcryptjs";
import { newId, nowIso } from "../src/utils/ids";
import { setMenuPrice } from "../src/modules/menu/menu.service";
import { User, PaymentMethod, MenuCategory, InventoryItem, MenuItem, RecipeVersion } from "../src/db/models";

export function ensureRoles() {
  // Roles are a schema enum now, not a lookup table — nothing to seed.
}

export async function makeUser(role: "ADMIN" | "MANAGER" | "STAFF" | "RIDER" = "ADMIN"): Promise<string> {
  const id = newId("user");
  const now = nowIso();
  await User.create({
    _id: id,
    username: `${role.toLowerCase()}_${id.slice(-6)}`,
    passwordHash: bcrypt.hashSync("x", 4),
    fullName: `${role} Test User`,
    role,
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function makePaymentMethod(type: "CASH" | "ONLINE" = "CASH"): Promise<string> {
  const id = newId("pm");
  await PaymentMethod.create({ _id: id, name: `${type}_${id.slice(-6)}`, type, active: true, sortOrder: 0 });
  return id;
}

export async function makeCategory(): Promise<string> {
  const id = newId("cat");
  await MenuCategory.create({ _id: id, name: `cat_${id.slice(-6)}`, sortOrder: 0, active: true });
  return id;
}

export async function makeInventoryItem(opts: { openingQtyBase?: number; costPaisePerBase?: number } = {}): Promise<string> {
  const id = newId("inv");
  await InventoryItem.create({
    _id: id,
    name: `item_${id.slice(-6)}`,
    category: "RAW_MATERIAL",
    baseUnit: "g",
    purchaseUnit: "kg",
    purchaseToBaseFactor: 1000,
    currentQtyBase: opts.openingQtyBase ?? 0,
    minStockBase: 0,
    reorderLevelBase: 0,
    avgCostPaisePerBase: opts.costPaisePerBase ?? 0,
    pricePending: false,
    active: true,
    createdAt: nowIso(),
  });
  return id;
}

export async function makeMenuItemWithRecipe(opts: {
  priceType: "HALF" | "FULL" | "SINGLE";
  pricePaise: number;
  ingredientQtyBase: number;
  ingredientCostPaisePerBase: number;
  userId: string;
}): Promise<{ menuItemId: string; inventoryItemId: string }> {
  const categoryId = await makeCategory();
  const menuItemId = newId("menuitem");
  await MenuItem.create({
    _id: menuItemId,
    categoryId,
    name: `menu_${menuItemId.slice(-6)}`,
    hasHalf: opts.priceType === "HALF",
    hasFull: opts.priceType === "FULL",
    hasSingle: opts.priceType === "SINGLE",
    unitLabel: "plate",
    status: "ACTIVE",
    createdAt: nowIso(),
  });

  await setMenuPrice(menuItemId, opts.priceType, opts.pricePaise, opts.userId);

  const inventoryItemId = await makeInventoryItem({ openingQtyBase: 1_000_000, costPaisePerBase: opts.ingredientCostPaisePerBase });

  const versionId = newId("recipe");
  await RecipeVersion.create({
    _id: versionId,
    menuItemId,
    priceType: opts.priceType,
    version: 1,
    effectiveFrom: nowIso(),
    createdBy: opts.userId,
    createdAt: nowIso(),
    recipeItems: [
      {
        inventoryItemId,
        quantityBase: opts.ingredientQtyBase,
        wastagePct: 0,
        yieldPct: 100,
        optional: false,
      },
    ],
  });

  return { menuItemId, inventoryItemId };
}

export async function getInventoryItem(id: string) {
  return InventoryItem.findById(id);
}
