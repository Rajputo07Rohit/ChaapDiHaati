/**
 * One-off backfill: every order completed before the 17-Sept COGS recipes
 * were added has cogs_paise = 0 / recipe_version_id = null on its lines
 * (MISSING_RECIPE_AT_SALE at the time) — normally COGS is frozen at sale
 * time on purpose (RULE 6, recipes can legitimately change over time), but
 * these lines never had a recipe to freeze in the first place, so applying
 * the recipe that exists NOW is a correction of a data gap, not a rewrite
 * of history.
 *
 * Re-runnable/idempotent: recomputes for any ACTIVE line whose effective
 * recipe is one of the 17-Sept flat-COGS ones (identified by its notes
 * field), always overwriting cogsPaise with cost-per-unit × item.quantity —
 * this fixes the first version of this script, which wrongly used the
 * per-unit recipe cost as the whole line's cost. Lines using any other
 * (real, non-flat) recipe are left untouched.
 *
 * Does NOT re-run any inventory movement — this is a reporting-only
 * correction to item.cogsPaise/recipeVersionId, since the ingredients for
 * these old sales were never actually deducted (and re-deducting them now,
 * after the fact, would be wrong).
 *
 * Usage: npx tsx src/db/imports/2026-09-17-backfill-cogs.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { Order } from "../models";
import { getEffectiveRecipeVersion, computeRecipeCost } from "../../modules/recipes/recipe.service";
import { nowIso } from "../../utils/ids";

async function main() {
  await connectMongo();
  const now = nowIso();

  const orders = await Order.find({ status: { $in: ["COMPLETED", "REFUNDED"] } });
  let ordersTouched = 0;
  let linesTouched = 0;
  const costCache = new Map<string, number>(); // recipeVersionId -> per-unit cost paise

  for (const order of orders) {
    let changed = false;
    for (const item of order.items) {
      if (item.status !== "ACTIVE") continue;

      const version = await getEffectiveRecipeVersion(item.menuItemId, item.priceType, now);
      if (!version) continue; // still no recipe for this item — nothing to backfill
      if (!version.notes?.startsWith("Flat COGS")) continue; // a real recipe, not one of ours — never touch it

      let perUnitCost = costCache.get(version.id);
      if (perUnitCost === undefined) {
        perUnitCost = (await computeRecipeCost(version.id)).totalCostPaise;
        costCache.set(version.id, perUnitCost);
      }
      if (perUnitCost <= 0) continue;

      const correctLineCost = perUnitCost * item.quantity;
      if (item.recipeVersionId === version.id && item.cogsPaise === correctLineCost) continue; // already correct

      item.recipeVersionId = version.id;
      item.cogsPaise = correctLineCost;
      changed = true;
      linesTouched++;
    }
    if (changed) {
      await order.save();
      ordersTouched++;
    }
  }

  console.log(`\n✓ Backfilled COGS on ${linesTouched} line(s) across ${ordersTouched} order(s).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
