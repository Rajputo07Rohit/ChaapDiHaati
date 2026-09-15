import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import * as menuService from "./menu.service";

export const menuRouter = Router();

menuRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ categories: await menuService.listMenu() });
  })
);

const createItemSchema = z.object({
  categoryId: z.string(),
  name: z.string().min(1),
  hasHalf: z.boolean().default(false),
  hasFull: z.boolean().default(false),
  hasSingle: z.boolean().default(false),
  unitLabel: z.string().default("plate"),
  halfLabel: z.string().default("Half"),
  fullLabel: z.string().default("Full"),
  halfPricePaise: z.number().int().min(0).optional(),
  fullPricePaise: z.number().int().min(0).optional(),
  singlePricePaise: z.number().int().min(0).optional(),
});

menuRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createItemSchema.parse(req.body);
    const id = await menuService.createMenuItem(input);

    if (input.hasHalf && input.halfPricePaise != null) await menuService.setMenuPrice(id, "HALF", input.halfPricePaise, req.user!.id);
    if (input.hasFull && input.fullPricePaise != null) await menuService.setMenuPrice(id, "FULL", input.fullPricePaise, req.user!.id);
    if (input.hasSingle && input.singlePricePaise != null) await menuService.setMenuPrice(id, "SINGLE", input.singlePricePaise, req.user!.id);

    await recordAudit({ userId: req.user!.id, action: "MENU_ITEM_CREATED", entityType: "menu_item", entityId: id, newValue: input });

    res.status(201).json({ item: await menuService.getMenuItemOrThrow(id) });
  })
);

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "UNAVAILABLE", "DISCONTINUED"]).optional(),
  halfLabel: z.string().optional(),
  fullLabel: z.string().optional(),
  halfPricePaise: z.number().int().min(0).optional(),
  fullPricePaise: z.number().int().min(0).optional(),
  singlePricePaise: z.number().int().min(0).optional(),
});

menuRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateItemSchema.parse(req.body);
    const existing = await menuService.getMenuItemOrThrow(req.params.id);

    if (input.name || input.status || input.halfLabel || input.fullLabel) {
      await menuService.updateMenuItemFields(req.params.id, input);
      await recordAudit({
        userId: req.user!.id,
        action: "MENU_ITEM_UPDATED",
        entityType: "menu_item",
        entityId: req.params.id,
        oldValue: existing,
        newValue: input,
      });
    }
    if (input.halfPricePaise != null) await menuService.setMenuPrice(req.params.id, "HALF", input.halfPricePaise, req.user!.id);
    if (input.fullPricePaise != null) await menuService.setMenuPrice(req.params.id, "FULL", input.fullPricePaise, req.user!.id);
    if (input.singlePricePaise != null) await menuService.setMenuPrice(req.params.id, "SINGLE", input.singlePricePaise, req.user!.id);

    res.json({ item: await menuService.getMenuItemOrThrow(req.params.id) });
  })
);

menuRouter.get(
  "/categories",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ categories: await menuService.listCategories() });
  })
);

const createCategorySchema = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) });

menuRouter.post(
  "/categories",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const category = await menuService.createCategory(input);
    res.status(201).json({ category });
  })
);
