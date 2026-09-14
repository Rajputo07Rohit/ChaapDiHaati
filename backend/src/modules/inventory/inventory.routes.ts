import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import { ConflictError } from "../../utils/errors";
import * as inventoryService from "./inventory.service";
import * as stockCountService from "../stockCount/stockCount.service";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const items = inventoryService.listInventoryItems({
      category: req.query.category as string | undefined,
      active: req.query.active === undefined ? undefined : req.query.active === "true",
    });
    res.json({ items });
  })
);

inventoryRouter.get("/low-stock", requireAuth, isManagerUp, (_req, res) => {
  res.json({ items: inventoryService.getLowStockItems() });
});

inventoryRouter.get("/value", requireAuth, isManagerUp, (_req, res) => {
  res.json({ valuePaise: inventoryService.getStockValuePaise() });
});

const createItemSchema = z.object({
  name: z.string().min(1),
  category: z.enum(["RAW_MATERIAL", "PACKAGING", "DISPOSABLE", "OTHER"]),
  baseUnit: z.enum(["g", "ml", "piece"]),
  purchaseUnit: z.string().min(1),
  purchaseToBaseFactor: z.number().positive(),
  minStockBase: z.number().min(0).default(0),
  reorderLevelBase: z.number().min(0).default(0),
  openingQtyBase: z.number().min(0).default(0),
  openingCostPaisePerBase: z.number().min(0).optional(),
  supplierId: z.string().optional(),
  pricePending: z.boolean().default(false),
});

inventoryRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createItemSchema.parse(req.body);

    const existing = db.prepare("SELECT id FROM inventory_items WHERE lower(name) = lower(?)").get(input.name);
    if (existing) {
      throw new ConflictError(`An inventory item named "${input.name}" already exists. Use Add Stock or Adjust on that item instead.`);
    }

    const id = newId("inv");
    const now = nowIso();

    const txn = db.transaction(() => {
      db.prepare(
        `INSERT INTO inventory_items
          (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, min_stock_base, reorder_level_base,
           avg_cost_paise_per_base, supplier_id, price_pending, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 1, ?)`
      ).run(
        id,
        input.name,
        input.category,
        input.baseUnit,
        input.purchaseUnit,
        input.purchaseToBaseFactor,
        input.minStockBase,
        input.reorderLevelBase,
        input.supplierId ?? null,
        input.pricePending ? 1 : 0,
        now
      );

      if (input.openingQtyBase > 0) {
        inventoryService.recordMovement({
          inventoryItemId: id,
          movementType: "OPENING_STOCK",
          direction: "IN",
          quantityBase: input.openingQtyBase,
          unitCostPaisePerBase: input.openingCostPaisePerBase ?? null,
          referenceType: "OPENING",
          businessDate: todayBusinessDate(),
          userId: req.user!.id,
        });
      }

      recordAudit({ userId: req.user!.id, action: "INVENTORY_ITEM_CREATED", entityType: "inventory_item", entityId: id, newValue: input });
    });
    txn();

    res.status(201).json({ item: inventoryService.getInventoryItemOrThrow(id) });
  })
);

const updateItemSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(["RAW_MATERIAL", "PACKAGING", "DISPOSABLE", "OTHER"]).optional(),
  purchaseUnit: z.string().min(1).optional(),
  purchaseToBaseFactor: z.number().positive().optional(),
  minStockBase: z.number().min(0).optional(),
  reorderLevelBase: z.number().min(0).optional(),
  supplierId: z.string().nullable().optional(),
  active: z.boolean().optional(),
  pricePending: z.boolean().optional(),
});

inventoryRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateItemSchema.parse(req.body);
    const existing = inventoryService.getInventoryItemOrThrow(req.params.id);

    if (input.name) {
      const dupe = db.prepare("SELECT id FROM inventory_items WHERE lower(name) = lower(?) AND id != ?").get(input.name, req.params.id);
      if (dupe) throw new ConflictError(`An inventory item named "${input.name}" already exists.`);
    }

    // Editing the purchase unit/conversion factor only changes how FUTURE
    // purchases convert into base units — every past movement was already
    // recorded in base units (g/ml/piece), so this can never rewrite history.
    db.prepare(
      `UPDATE inventory_items SET
        name = COALESCE(?, name), category = COALESCE(?, category),
        purchase_unit = COALESCE(?, purchase_unit), purchase_to_base_factor = COALESCE(?, purchase_to_base_factor),
        min_stock_base = COALESCE(?, min_stock_base), reorder_level_base = COALESCE(?, reorder_level_base),
        supplier_id = COALESCE(?, supplier_id), active = COALESCE(?, active), price_pending = COALESCE(?, price_pending)
       WHERE id = ?`
    ).run(
      input.name ?? null,
      input.category ?? null,
      input.purchaseUnit ?? null,
      input.purchaseToBaseFactor ?? null,
      input.minStockBase ?? null,
      input.reorderLevelBase ?? null,
      input.supplierId ?? null,
      input.active === undefined ? null : input.active ? 1 : 0,
      input.pricePending === undefined ? null : input.pricePending ? 1 : 0,
      req.params.id
    );

    recordAudit({
      userId: req.user!.id,
      action: "INVENTORY_ITEM_UPDATED",
      entityType: "inventory_item",
      entityId: req.params.id,
      oldValue: existing,
      newValue: input,
    });

    res.json({ item: inventoryService.getInventoryItemOrThrow(req.params.id) });
  })
);

/**
 * Removing an item is only ever truly safe when nothing references it yet —
 * no stock movement, no recipe. If the item has real history, permanently
 * deleting the row would silently erase past COGS/movements, so this falls
 * back to deactivating it instead (hidden from the default list, same as
 * the "Show inactive" toggle) and says so, rather than making the caller
 * pick the right operation themselves.
 */
inventoryRouter.delete(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const existing = inventoryService.getInventoryItemOrThrow(req.params.id);

    const movementCount = (db.prepare("SELECT COUNT(*) as c FROM inventory_movements WHERE inventory_item_id = ?").get(req.params.id) as { c: number }).c;
    const recipeCount = (db.prepare("SELECT COUNT(*) as c FROM recipe_items WHERE inventory_item_id = ?").get(req.params.id) as { c: number }).c;
    const purchaseCount = (db.prepare("SELECT COUNT(*) as c FROM purchase_items WHERE inventory_item_id = ?").get(req.params.id) as { c: number }).c;

    if (movementCount === 0 && recipeCount === 0 && purchaseCount === 0) {
      db.prepare("DELETE FROM inventory_items WHERE id = ?").run(req.params.id);
      recordAudit({
        userId: req.user!.id,
        action: "INVENTORY_ITEM_DELETED",
        entityType: "inventory_item",
        entityId: req.params.id,
        oldValue: existing,
      });
      return res.json({ deleted: true, deactivated: false });
    }

    db.prepare("UPDATE inventory_items SET active = 0 WHERE id = ?").run(req.params.id);
    recordAudit({
      userId: req.user!.id,
      action: "INVENTORY_ITEM_DEACTIVATED",
      entityType: "inventory_item",
      entityId: req.params.id,
      oldValue: existing,
      reason: `Has ${movementCount} stock movement(s), ${purchaseCount} purchase line(s) and/or ${recipeCount} recipe reference(s) — deactivated instead of deleted to preserve history.`,
    });
    res.json({
      deleted: false,
      deactivated: true,
      reason: "This item has real stock/purchase/recipe history, so it was hidden instead of permanently deleted, to keep that history intact.",
    });
  })
);

const adjustSchema = z.object({
  inventoryItemId: z.string(),
  direction: z.enum(["IN", "OUT"]),
  quantityBase: z.number().positive(),
  movementType: z.enum(["WASTE", "SPOILAGE", "DAMAGE", "STOCK_ADJUSTMENT"]),
  reason: z.string().min(1),
  // Only meaningful for an IN adjustment — lets "Add Stock" declare a known
  // cost at the same time, same weighted-average math as a real purchase.
  unitCostPaisePerBase: z.number().min(0).optional(),
});

inventoryRouter.post(
  "/adjust",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = adjustSchema.parse(req.body);
    const result = inventoryService.recordMovement({
      inventoryItemId: input.inventoryItemId,
      movementType: input.movementType,
      direction: input.direction,
      quantityBase: input.quantityBase,
      unitCostPaisePerBase: input.direction === "IN" ? input.unitCostPaisePerBase ?? null : null,
      reason: input.reason,
      referenceType: "MANUAL",
      businessDate: todayBusinessDate(),
      userId: req.user!.id,
      allowNegativeStock: req.user!.role === "ADMIN",
    });
    recordAudit({
      userId: req.user!.id,
      action: "STOCK_ADJUSTED",
      entityType: "inventory_item",
      entityId: input.inventoryItemId,
      newValue: input,
      reason: input.reason,
    });
    res.json(result);
  })
);

const setCostSchema = z.object({
  costPaisePerBase: z.number().positive(),
  reason: z.string().min(1),
});

/**
 * Declares the cost basis for stock ALREADY on hand — e.g. it was added via
 * Add Stock with no price yet, and the real cost is known now. This does not
 * move any quantity (no inventory_movement row — there was no physical
 * transaction), so it's Admin-only and always audited with the reason, same
 * as any other financial correction after the fact.
 */
inventoryRouter.post(
  "/:id/set-cost",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = setCostSchema.parse(req.body);
    const existing = inventoryService.getInventoryItemOrThrow(req.params.id);

    db.prepare(
      `UPDATE inventory_items SET avg_cost_paise_per_base = ?, last_purchase_cost_paise_per_base = ?, price_pending = 0 WHERE id = ?`
    ).run(input.costPaisePerBase, input.costPaisePerBase, req.params.id);

    recordAudit({
      userId: req.user!.id,
      action: "INVENTORY_COST_SET",
      entityType: "inventory_item",
      entityId: req.params.id,
      oldValue: { avgCostPaisePerBase: existing.avg_cost_paise_per_base, pricePending: !!existing.price_pending },
      newValue: { avgCostPaisePerBase: input.costPaisePerBase, pricePending: false },
      reason: input.reason,
    });

    res.json({ item: inventoryService.getInventoryItemOrThrow(req.params.id) });
  })
);

inventoryRouter.get("/movements", requireAuth, isManagerUp, (req, res) => {
  const { from, to, itemId } = req.query as { from?: string; to?: string; itemId?: string };
  let sql = "SELECT * FROM inventory_movements WHERE 1=1";
  const params: unknown[] = [];
  if (from && to) {
    sql += " AND business_date BETWEEN ? AND ?";
    params.push(from, to);
  }
  if (itemId) {
    sql += " AND inventory_item_id = ?";
    params.push(itemId);
  }
  sql += " ORDER BY created_at DESC LIMIT 500";
  res.json({ movements: db.prepare(sql).all(...params) });
});

// ---- Stock counts ----
inventoryRouter.get("/counts", requireAuth, isManagerUp, (_req, res) => {
  res.json({ counts: stockCountService.listStockCounts() });
});

inventoryRouter.post(
  "/counts",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const count = stockCountService.createStockCount(req.user!.id, req.body?.category);
    res.status(201).json({ count, items: stockCountService.getStockCountItems(count.id) });
  })
);

inventoryRouter.get(
  "/counts/:id",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const count = stockCountService.getStockCountOrThrow(req.params.id);
    res.json({ count, items: stockCountService.getStockCountItems(count.id) });
  })
);

const submitCountSchema = z.object({
  lines: z.array(
    z.object({
      inventoryItemId: z.string(),
      physicalQtyBase: z.number().min(0),
      reason: z.string().optional(),
      notes: z.string().optional(),
    })
  ),
});

inventoryRouter.post(
  "/counts/:id/submit",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = submitCountSchema.parse(req.body);
    const count = stockCountService.submitStockCount(req.params.id, input.lines, req.user!.id);
    res.json({ count, items: stockCountService.getStockCountItems(count.id) });
  })
);
