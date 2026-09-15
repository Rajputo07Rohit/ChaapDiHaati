import { RecipeVersion } from "../../db/models";
import { getInventoryItemOrThrow } from "../inventory/inventory.service";

export interface RecipeVersionRow {
  id: string;
  menu_item_id: string;
  price_type: "HALF" | "FULL" | "SINGLE";
  version: number;
  effective_from: string;
  effective_to: string | null;
  notes: string | null;
}

export interface RecipeItemRow {
  id: string;
  recipe_version_id: string;
  inventory_item_id: string;
  quantity_base: number;
  wastage_pct: number;
  yield_pct: number;
  optional: number;
}

/**
 * Finds the recipe version that was in effect at a given point in time.
 * This is how historical orders always cost against the recipe that was
 * actually used, even after the recipe changes later.
 */
export async function getEffectiveRecipeVersion(
  menuItemId: string,
  priceType: "HALF" | "FULL" | "SINGLE",
  atIso: string
): Promise<RecipeVersionRow | undefined> {
  const doc = await RecipeVersion.findOne({
    menuItemId,
    priceType,
    effectiveFrom: { $lte: atIso },
    $or: [{ effectiveTo: null }, { effectiveTo: { $gt: atIso } }],
  }).sort({ version: -1 });

  if (!doc) return undefined;
  return {
    id: doc._id,
    menu_item_id: doc.menuItemId,
    price_type: doc.priceType,
    version: doc.version,
    effective_from: doc.effectiveFrom,
    effective_to: doc.effectiveTo,
    notes: doc.notes,
  };
}

export async function getRecipeItems(recipeVersionId: string): Promise<RecipeItemRow[]> {
  const doc = await RecipeVersion.findById(recipeVersionId);
  if (!doc) return [];
  return doc.recipeItems.map((ri) => ({
    id: String(ri._id),
    recipe_version_id: recipeVersionId,
    inventory_item_id: ri.inventoryItemId,
    quantity_base: ri.quantityBase,
    wastage_pct: ri.wastagePct,
    yield_pct: ri.yieldPct,
    optional: ri.optional ? 1 : 0,
  }));
}

export interface RecipeCostBreakdownLine {
  inventoryItemId: string;
  inventoryItemName: string;
  baseUnit: string;
  quantityBaseNeeded: number;
  unitCostPaisePerBase: number;
  costPaise: number;
}

export interface RecipeCostResult {
  totalCostPaise: number;
  lines: RecipeCostBreakdownLine[];
}

/**
 * Computes the theoretical cost of one unit of a recipe using CURRENT
 * average costs — used for menu costing / pricing screens, not for
 * historical order COGS (which is computed at consumption time instead).
 */
export async function computeRecipeCost(recipeVersionId: string): Promise<RecipeCostResult> {
  const items = await getRecipeItems(recipeVersionId);
  const lines: RecipeCostBreakdownLine[] = [];
  let total = 0;

  for (const ri of items) {
    const invItem = await getInventoryItemOrThrow(ri.inventory_item_id);
    const effectiveQty = (ri.quantity_base * (1 + ri.wastage_pct / 100)) / (ri.yield_pct / 100);
    const costPaise = Math.round(effectiveQty * invItem.avg_cost_paise_per_base);
    lines.push({
      inventoryItemId: invItem.id,
      inventoryItemName: invItem.name,
      baseUnit: invItem.base_unit,
      quantityBaseNeeded: effectiveQty,
      unitCostPaisePerBase: invItem.avg_cost_paise_per_base,
      costPaise,
    });
    total += costPaise;
  }

  return { totalCostPaise: total, lines };
}
