import { db } from "../../db/connection";
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

const findEffectiveVersionStmt = db.prepare(`
  SELECT * FROM recipe_versions
  WHERE menu_item_id = ? AND price_type = ?
    AND effective_from <= ?
    AND (effective_to IS NULL OR effective_to > ?)
  ORDER BY version DESC
  LIMIT 1
`);

const recipeItemsStmt = db.prepare("SELECT * FROM recipe_items WHERE recipe_version_id = ?");

/**
 * Finds the recipe version that was in effect at a given point in time.
 * This is how historical orders always cost against the recipe that was
 * actually used, even after the recipe changes later.
 */
export function getEffectiveRecipeVersion(
  menuItemId: string,
  priceType: "HALF" | "FULL" | "SINGLE",
  atIso: string
): RecipeVersionRow | undefined {
  return findEffectiveVersionStmt.get(menuItemId, priceType, atIso, atIso) as RecipeVersionRow | undefined;
}

export function getRecipeItems(recipeVersionId: string): RecipeItemRow[] {
  return recipeItemsStmt.all(recipeVersionId) as RecipeItemRow[];
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
export function computeRecipeCost(recipeVersionId: string): RecipeCostResult {
  const items = getRecipeItems(recipeVersionId);
  const lines: RecipeCostBreakdownLine[] = [];
  let total = 0;

  for (const ri of items) {
    const invItem = getInventoryItemOrThrow(ri.inventory_item_id);
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
