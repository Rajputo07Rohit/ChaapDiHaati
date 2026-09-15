import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import * as inventoryService from "./inventory.service";
import * as stockCountService from "../stockCount/stockCount.service";

export const inventoryRouter = Router();

inventoryRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const items = await inventoryService.listInventoryItems({
      category: req.query.category as string | undefined,
      active: req.query.active === undefined ? undefined : req.query.active === "true",
    });
    res.json({ items });
  })
);

inventoryRouter.get(
  "/low-stock",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ items: await inventoryService.getLowStockItems() });
  })
);

inventoryRouter.get(
  "/value",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ valuePaise: await inventoryService.getStockValuePaise() });
  })
);

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
    const id = await inventoryService.createInventoryItem(input, req.user!.id);
    res.status(201).json({ item: await inventoryService.getInventoryItemOrThrow(id) });
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
    const item = await inventoryService.updateInventoryItem(req.params.id, input, req.user!.id);
    res.json({ item });
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
    res.json(await inventoryService.deleteOrDeactivateInventoryItem(req.params.id, req.user!.id));
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

    const result = await withTransaction(async (session) => {
      const r = await inventoryService.recordMovement(
        {
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
        },
        session
      );
      await recordAudit(
        {
          userId: req.user!.id,
          action: "STOCK_ADJUSTED",
          entityType: "inventory_item",
          entityId: input.inventoryItemId,
          newValue: input,
          reason: input.reason,
        },
        session
      );
      return r;
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
    const item = await inventoryService.setInventoryItemCost(req.params.id, input.costPaisePerBase, input.reason, req.user!.id);
    res.json({ item });
  })
);

inventoryRouter.get(
  "/movements",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to, itemId } = req.query as { from?: string; to?: string; itemId?: string };
    res.json({ movements: await inventoryService.listMovements({ from, to, itemId }) });
  })
);

// ---- Stock counts ----
inventoryRouter.get(
  "/counts",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ counts: await stockCountService.listStockCounts() });
  })
);

inventoryRouter.post(
  "/counts",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const count = await stockCountService.createStockCount(req.user!.id, req.body?.category);
    res.status(201).json({ count, items: await stockCountService.getStockCountItems(count.id) });
  })
);

inventoryRouter.get(
  "/counts/:id",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const count = await stockCountService.getStockCountOrThrow(req.params.id);
    res.json({ count, items: await stockCountService.getStockCountItems(count.id) });
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
    const count = await stockCountService.submitStockCount(req.params.id, input.lines, req.user!.id);
    res.json({ count, items: await stockCountService.getStockCountItems(count.id) });
  })
);
