import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import { NotFoundError } from "../../utils/errors";
import * as menuService from "./menu.service";

export const menuRouter = Router();

menuRouter.get("/", requireAuth, (_req, res) => {
  res.json({ categories: menuService.listMenu() });
});

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
    const id = newId("menuitem");
    const now = nowIso();

    db.prepare(
      `INSERT INTO menu_items (id, category_id, name, has_half, has_full, has_single, unit_label, half_label, full_label, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`
    ).run(
      id,
      input.categoryId,
      input.name,
      input.hasHalf ? 1 : 0,
      input.hasFull ? 1 : 0,
      input.hasSingle ? 1 : 0,
      input.unitLabel,
      input.halfLabel,
      input.fullLabel,
      now
    );

    if (input.hasHalf && input.halfPricePaise != null) menuService.setMenuPrice(id, "HALF", input.halfPricePaise, req.user!.id);
    if (input.hasFull && input.fullPricePaise != null) menuService.setMenuPrice(id, "FULL", input.fullPricePaise, req.user!.id);
    if (input.hasSingle && input.singlePricePaise != null) menuService.setMenuPrice(id, "SINGLE", input.singlePricePaise, req.user!.id);

    recordAudit({ userId: req.user!.id, action: "MENU_ITEM_CREATED", entityType: "menu_item", entityId: id, newValue: input });

    res.status(201).json({ item: menuService.getMenuItemOrThrow(id) });
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
    const existing = menuService.getMenuItemOrThrow(req.params.id);

    if (input.name || input.status || input.halfLabel || input.fullLabel) {
      db.prepare(
        `UPDATE menu_items SET name = COALESCE(?, name), status = COALESCE(?, status),
         half_label = COALESCE(?, half_label), full_label = COALESCE(?, full_label) WHERE id = ?`
      ).run(input.name ?? null, input.status ?? null, input.halfLabel ?? null, input.fullLabel ?? null, req.params.id);
      recordAudit({
        userId: req.user!.id,
        action: "MENU_ITEM_UPDATED",
        entityType: "menu_item",
        entityId: req.params.id,
        oldValue: existing,
        newValue: input,
      });
    }
    if (input.halfPricePaise != null) menuService.setMenuPrice(req.params.id, "HALF", input.halfPricePaise, req.user!.id);
    if (input.fullPricePaise != null) menuService.setMenuPrice(req.params.id, "FULL", input.fullPricePaise, req.user!.id);
    if (input.singlePricePaise != null) menuService.setMenuPrice(req.params.id, "SINGLE", input.singlePricePaise, req.user!.id);

    res.json({ item: menuService.getMenuItemOrThrow(req.params.id) });
  })
);

menuRouter.get("/categories", requireAuth, (_req, res) => {
  res.json({ categories: db.prepare("SELECT * FROM menu_categories ORDER BY sort_order ASC").all() });
});

const createCategorySchema = z.object({ name: z.string().min(1), sortOrder: z.number().int().default(0) });

menuRouter.post(
  "/categories",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createCategorySchema.parse(req.body);
    const id = newId("cat");
    db.prepare("INSERT INTO menu_categories (id, name, sort_order, active) VALUES (?, ?, ?, 1)").run(id, input.name, input.sortOrder);
    res.status(201).json({ category: db.prepare("SELECT * FROM menu_categories WHERE id = ?").get(id) });
  })
);
