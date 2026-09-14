import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import * as recipeService from "./recipe.service";

export const recipesRouter = Router();

// Viewing a recipe/cost breakdown is available to Manager+ (matches their
// visibility into COGS/profit); only Admin may create or change a recipe.
recipesRouter.get(
  "/:menuItemId/:priceType",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const priceType = req.params.priceType.toUpperCase() as "HALF" | "FULL" | "SINGLE";
    const version = recipeService.getEffectiveRecipeVersion(req.params.menuItemId, priceType, nowIso());
    if (!version) return res.json({ version: null, items: [], cost: null });
    const items = recipeService.getRecipeItems(version.id);
    const cost = recipeService.computeRecipeCost(version.id);
    res.json({ version, items, cost });
  })
);

const recipeItemSchema = z.object({
  inventoryItemId: z.string(),
  quantityBase: z.number().positive(),
  wastagePct: z.number().min(0).max(100).default(0),
  yieldPct: z.number().min(1).max(100).default(100),
  optional: z.boolean().default(false),
});

const createRecipeSchema = z.object({
  menuItemId: z.string(),
  priceType: z.enum(["HALF", "FULL", "SINGLE"]),
  notes: z.string().optional(),
  items: z.array(recipeItemSchema).min(1),
});

/**
 * Creates a NEW recipe version and closes the previous one. Historical
 * orders keep referencing the recipe version that was effective when they
 * were sold (RULE 6), so this never rewrites past COGS.
 */
recipesRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createRecipeSchema.parse(req.body);
    const now = nowIso();

    const txn = db.transaction(() => {
      const previous = db
        .prepare(
          "SELECT * FROM recipe_versions WHERE menu_item_id = ? AND price_type = ? AND effective_to IS NULL"
        )
        .get(input.menuItemId, input.priceType) as { id: string; version: number } | undefined;

      if (previous) {
        db.prepare("UPDATE recipe_versions SET effective_to = ? WHERE id = ?").run(now, previous.id);
      }

      const versionId = newId("recipe");
      const versionNumber = (previous?.version ?? 0) + 1;

      db.prepare(
        `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, notes, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(versionId, input.menuItemId, input.priceType, versionNumber, now, input.notes ?? null, req.user!.id, now);

      for (const item of input.items) {
        db.prepare(
          `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(newId("ritem"), versionId, item.inventoryItemId, item.quantityBase, item.wastagePct, item.yieldPct, item.optional ? 1 : 0);
      }

      recordAudit({
        userId: req.user!.id,
        action: "RECIPE_CHANGED",
        entityType: "menu_item",
        entityId: input.menuItemId,
        oldValue: previous ? { previousVersionId: previous.id } : null,
        newValue: { versionId, versionNumber, priceType: input.priceType, ingredientCount: input.items.length },
      });

      return versionId;
    });

    const versionId = txn();
    const items = recipeService.getRecipeItems(versionId);
    const cost = recipeService.computeRecipeCost(versionId);
    res.status(201).json({ versionId, items, cost });
  })
);
