import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isAnyRole } from "../../middleware/rbac";
import * as discountsService from "./discounts.service";

export const discountsRouter = Router();

// Any staff member sees only active rules — this is what the POS cart uses
// to offer "apply this discount" buttons.
discountsRouter.get(
  "/",
  requireAuth,
  isAnyRole,
  asyncHandler(async (_req, res) => {
    res.json({ discounts: await discountsService.listDiscountRules(true) });
  })
);

// Admin management screen needs inactive rules too, to re-enable them.
discountsRouter.get(
  "/all",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ discounts: await discountsService.listDiscountRules(false) });
  })
);

const ruleSchema = z.object({
  name: z.string().min(1),
  menuItemIds: z.array(z.string()).default([]),
  categoryIds: z.array(z.string()).default([]),
  discountType: z.enum(["FLAT", "PERCENTAGE"]),
  discountValue: z.number().min(0),
});

discountsRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = ruleSchema.parse(req.body);
    if (input.menuItemIds.length === 0 && input.categoryIds.length === 0) {
      return res.status(400).json({ error: "Pick at least one product or category for this discount to apply to." });
    }
    const rule = await discountsService.createDiscountRule(input, req.user!.id);
    res.status(201).json({ discount: rule });
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  menuItemIds: z.array(z.string()).optional(),
  categoryIds: z.array(z.string()).optional(),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountValue: z.number().min(0).optional(),
  active: z.boolean().optional(),
});

discountsRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const rule = await discountsService.updateDiscountRule(req.params.id, input, req.user!.id);
    res.json({ discount: rule });
  })
);

discountsRouter.delete(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    await discountsService.deleteDiscountRule(req.params.id, req.user!.id);
    res.status(204).send();
  })
);
