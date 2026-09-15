import { Router } from "express";
import { z } from "zod";
import { RecipeVersion } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
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
    const version = await recipeService.getEffectiveRecipeVersion(req.params.menuItemId, priceType, nowIso());
    if (!version) return res.json({ version: null, items: [], cost: null });
    const items = await recipeService.getRecipeItems(version.id);
    const cost = await recipeService.computeRecipeCost(version.id);
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

    const versionId = await withTransaction(async (session) => {
      const previous = await RecipeVersion.findOne({ menuItemId: input.menuItemId, priceType: input.priceType, effectiveTo: null }).session(
        session
      );

      if (previous) {
        previous.effectiveTo = now;
        await previous.save({ session });
      }

      const newVersionId = newId("recipe");
      const versionNumber = (previous?.version ?? 0) + 1;

      await RecipeVersion.create(
        [
          {
            _id: newVersionId,
            menuItemId: input.menuItemId,
            priceType: input.priceType,
            version: versionNumber,
            effectiveFrom: now,
            notes: input.notes ?? null,
            createdBy: req.user!.id,
            createdAt: now,
            recipeItems: input.items.map((item) => ({
              inventoryItemId: item.inventoryItemId,
              quantityBase: item.quantityBase,
              wastagePct: item.wastagePct,
              yieldPct: item.yieldPct,
              optional: item.optional,
            })),
          },
        ],
        { session }
      );

      await recordAudit(
        {
          userId: req.user!.id,
          action: "RECIPE_CHANGED",
          entityType: "menu_item",
          entityId: input.menuItemId,
          oldValue: previous ? { previousVersionId: previous._id } : null,
          newValue: { versionId: newVersionId, versionNumber, priceType: input.priceType, ingredientCount: input.items.length },
        },
        session
      );

      return newVersionId;
    });

    const items = await recipeService.getRecipeItems(versionId);
    const cost = await recipeService.computeRecipeCost(versionId);
    res.status(201).json({ versionId, items, cost });
  })
);
