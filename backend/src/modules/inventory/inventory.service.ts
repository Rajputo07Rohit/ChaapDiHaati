import { ClientSession } from "mongoose";
import { InventoryItem, InventoryItemDoc, InventoryMovement, Purchase, RecipeVersion, WastageRecord } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { ConflictError, ValidationError, NotFoundError } from "../../utils/errors";
import { COST_UPDATING_IN_TYPES, Direction, InventoryItemRow, MovementType, StockStatus } from "./inventory.types";

export interface RecordMovementInput {
  inventoryItemId: string;
  movementType: MovementType;
  direction: Direction;
  quantityBase: number;
  unitCostPaisePerBase?: number | null;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  businessDate: string;
  userId: string | null;
  allowNegativeStock?: boolean;
}

export interface MovementResult {
  movementId: string;
  totalCostPaise: number | null;
  resultingQtyBase: number;
  wentNegative: boolean;
}

function toRow(doc: InventoryItemDoc): InventoryItemRow {
  return {
    id: doc._id,
    name: doc.name,
    category: doc.category,
    base_unit: doc.baseUnit,
    purchase_unit: doc.purchaseUnit,
    purchase_to_base_factor: doc.purchaseToBaseFactor,
    current_qty_base: doc.currentQtyBase,
    min_stock_base: doc.minStockBase,
    reorder_level_base: doc.reorderLevelBase,
    avg_cost_paise_per_base: doc.avgCostPaisePerBase,
    last_purchase_cost_paise_per_base: doc.lastPurchaseCostPaisePerBase,
    supplier_id: doc.supplierId,
    price_pending: doc.pricePending ? 1 : 0,
    active: doc.active ? 1 : 0,
    created_at: doc.createdAt,
  };
}

export async function getInventoryItemOrThrow(id: string, session?: ClientSession): Promise<InventoryItemRow> {
  const doc = await InventoryItem.findById(id).session(session ?? null);
  if (!doc) throw new NotFoundError("Inventory item");
  return toRow(doc);
}

/**
 * Records one stock movement and updates the cached current_qty_base /
 * avg_cost_paise_per_base on inventory_items. Must be called with a session
 * that is inside an open transaction started by the caller — the read of
 * the item's current quantity/cost and the write of the new values must be
 * isolated together, or a concurrent movement on the same item could race.
 */
export async function recordMovement(input: RecordMovementInput, session: ClientSession): Promise<MovementResult> {
  const item = await InventoryItem.findById(input.inventoryItemId).session(session);
  if (!item) throw new NotFoundError("Inventory item");
  if (input.quantityBase < 0) throw new ValidationError("Movement quantity cannot be negative.");
  if (input.quantityBase === 0) throw new ValidationError("Movement quantity must be greater than zero.");

  const signedDelta = input.direction === "IN" ? input.quantityBase : -input.quantityBase;
  const resultingQty = item.currentQtyBase + signedDelta;
  const wentNegative = resultingQty < 0;

  if (wentNegative && !input.allowNegativeStock) {
    throw new ValidationError(
      `Insufficient stock for ${item.name}: have ${item.currentQtyBase}${item.baseUnit}, need ${input.quantityBase}${item.baseUnit}. Admin override required to proceed.`
    );
  }

  let newAvgCost = item.avgCostPaisePerBase;
  let unitCostForMovement = input.unitCostPaisePerBase ?? null;
  let lastPurchaseCost: number | null = item.lastPurchaseCostPaisePerBase;
  // A real, known cost has just arrived for this item — it is no longer
  // "PRICE PENDING" even if it was created that way, or was purchased
  // earlier with an unconfirmed price.
  let clearsPricePending = false;

  if (input.direction === "IN") {
    if (COST_UPDATING_IN_TYPES.includes(input.movementType) && input.unitCostPaisePerBase != null) {
      const existingValue = item.currentQtyBase * item.avgCostPaisePerBase;
      const incomingValue = input.quantityBase * input.unitCostPaisePerBase;
      const totalQty = item.currentQtyBase + input.quantityBase;
      newAvgCost = totalQty > 0 ? (existingValue + incomingValue) / totalQty : input.unitCostPaisePerBase;
      if (input.movementType === "PURCHASE") lastPurchaseCost = input.unitCostPaisePerBase;
      clearsPricePending = true;
    } else if (unitCostForMovement == null) {
      unitCostForMovement = item.avgCostPaisePerBase;
    }
  } else {
    // OUT movements are valued at current weighted-average cost; average is unchanged.
    unitCostForMovement = item.avgCostPaisePerBase;
  }

  const totalCostPaise = unitCostForMovement != null ? Math.round(unitCostForMovement * input.quantityBase) : null;

  const movementId = newId("mov");
  const now = nowIso();

  await InventoryMovement.create(
    [
      {
        _id: movementId,
        inventoryItemId: input.inventoryItemId,
        movementType: input.movementType,
        direction: input.direction,
        quantityBase: input.quantityBase,
        unitCostPaisePerBase: unitCostForMovement,
        totalCostPaise,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        businessDate: input.businessDate,
        createdBy: input.userId,
        createdAt: now,
      },
    ],
    { session }
  );

  item.currentQtyBase = resultingQty;
  item.avgCostPaisePerBase = newAvgCost;
  if (lastPurchaseCost != null) item.lastPurchaseCostPaisePerBase = lastPurchaseCost;
  if (clearsPricePending) item.pricePending = false;
  await item.save({ session });

  const wastageTypes = ["WASTE", "SPOILAGE", "DAMAGE"] as const;
  if ((wastageTypes as readonly string[]).includes(input.movementType)) {
    await WastageRecord.create(
      [
        {
          _id: newId("waste"),
          inventoryMovementId: movementId,
          inventoryItemId: item._id,
          quantityBase: input.quantityBase,
          totalCostPaise: totalCostPaise ?? 0,
          wastageType: input.movementType as (typeof wastageTypes)[number],
          reason: input.reason ?? "Not specified",
          businessDate: input.businessDate,
          createdBy: input.userId,
          createdAt: now,
        },
      ],
      { session }
    );
  }

  if (wentNegative) {
    await recordAudit(
      {
        userId: input.userId,
        action: "NEGATIVE_STOCK_OVERRIDE",
        entityType: "inventory_item",
        entityId: item._id,
        oldValue: { qty: item.currentQtyBase - signedDelta },
        newValue: { qty: resultingQty },
        reason: input.reason,
      },
      session
    );
  }

  return { movementId, totalCostPaise, resultingQtyBase: resultingQty, wentNegative };
}

export function stockStatusOf(item: InventoryItemRow): StockStatus {
  if (item.current_qty_base <= 0) return "OUT_OF_STOCK";
  if (item.current_qty_base <= item.min_stock_base) return "CRITICAL";
  if (item.current_qty_base <= item.reorder_level_base) return "LOW";
  return "HEALTHY";
}

export async function listInventoryItems(filters: { category?: string; active?: boolean } = {}) {
  const query: Record<string, unknown> = {};
  if (filters.category) query.category = filters.category;
  if (filters.active !== undefined) query.active = filters.active;
  const docs = await InventoryItem.find(query).sort({ name: 1 });
  return docs.map(toRow).map((r) => ({ ...r, stockStatus: stockStatusOf(r) }));
}

export async function getStockValuePaise(): Promise<number> {
  const result = await InventoryItem.aggregate([
    { $match: { active: true } },
    { $group: { _id: null, total: { $sum: { $multiply: ["$currentQtyBase", "$avgCostPaisePerBase"] } } } },
  ]);
  return Math.round(result[0]?.total ?? 0);
}

export async function getLowStockItems() {
  const items = await listInventoryItems({ active: true });
  return items.filter((i) => i.stockStatus !== "HEALTHY");
}

async function assertNameNotTaken(name: string, exceptId?: string): Promise<void> {
  const query: Record<string, unknown> = { name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } };
  if (exceptId) query._id = { $ne: exceptId };
  const dupe = await InventoryItem.findOne(query);
  if (dupe) throw new ConflictError(`An inventory item named "${name}" already exists.`);
}

export interface CreateInventoryItemInput {
  name: string;
  category: InventoryItemRow["category"];
  baseUnit: InventoryItemRow["base_unit"];
  purchaseUnit: string;
  purchaseToBaseFactor: number;
  minStockBase: number;
  reorderLevelBase: number;
  openingQtyBase: number;
  openingCostPaisePerBase?: number;
  supplierId?: string;
  pricePending: boolean;
}

export async function createInventoryItem(input: CreateInventoryItemInput, userId: string): Promise<string> {
  await assertNameNotTaken(input.name);
  const id = newId("inv");
  const now = nowIso();

  await withTransaction(async (session) => {
    await InventoryItem.create(
      [
        {
          _id: id,
          name: input.name,
          category: input.category,
          baseUnit: input.baseUnit,
          purchaseUnit: input.purchaseUnit,
          purchaseToBaseFactor: input.purchaseToBaseFactor,
          currentQtyBase: 0,
          minStockBase: input.minStockBase,
          reorderLevelBase: input.reorderLevelBase,
          avgCostPaisePerBase: 0,
          supplierId: input.supplierId ?? null,
          pricePending: input.pricePending,
          active: true,
          createdAt: now,
        },
      ],
      { session }
    );

    if (input.openingQtyBase > 0) {
      await recordMovement(
        {
          inventoryItemId: id,
          movementType: "OPENING_STOCK",
          direction: "IN",
          quantityBase: input.openingQtyBase,
          unitCostPaisePerBase: input.openingCostPaisePerBase ?? null,
          referenceType: "OPENING",
          businessDate: todayBusinessDate(),
          userId,
        },
        session
      );
    }

    await recordAudit({ userId, action: "INVENTORY_ITEM_CREATED", entityType: "inventory_item", entityId: id, newValue: input }, session);
  });

  return id;
}

export interface UpdateInventoryItemInput {
  name?: string;
  category?: InventoryItemRow["category"];
  purchaseUnit?: string;
  purchaseToBaseFactor?: number;
  minStockBase?: number;
  reorderLevelBase?: number;
  supplierId?: string | null;
  active?: boolean;
  pricePending?: boolean;
}

export async function updateInventoryItem(id: string, input: UpdateInventoryItemInput, userId: string): Promise<InventoryItemRow> {
  const existing = await InventoryItem.findById(id);
  if (!existing) throw new NotFoundError("Inventory item");
  const existingRow = toRow(existing);

  if (input.name) await assertNameNotTaken(input.name, id);

  if (input.name !== undefined) existing.name = input.name;
  if (input.category !== undefined) existing.category = input.category;
  if (input.purchaseUnit !== undefined) existing.purchaseUnit = input.purchaseUnit;
  if (input.purchaseToBaseFactor !== undefined) existing.purchaseToBaseFactor = input.purchaseToBaseFactor;
  if (input.minStockBase !== undefined) existing.minStockBase = input.minStockBase;
  if (input.reorderLevelBase !== undefined) existing.reorderLevelBase = input.reorderLevelBase;
  if (input.supplierId !== undefined) existing.supplierId = input.supplierId;
  if (input.active !== undefined) existing.active = input.active;
  if (input.pricePending !== undefined) existing.pricePending = input.pricePending;
  await existing.save();

  await recordAudit({ userId, action: "INVENTORY_ITEM_UPDATED", entityType: "inventory_item", entityId: id, oldValue: existingRow, newValue: input });

  return toRow(existing);
}

/**
 * Removing an item is only ever truly safe when nothing references it yet —
 * no stock movement, no recipe. If the item has real history, permanently
 * deleting the row would silently erase past COGS/movements, so this falls
 * back to deactivating it instead.
 */
export async function deleteOrDeactivateInventoryItem(id: string, userId: string) {
  const existing = await getInventoryItemOrThrow(id);

  const [movementCount, recipeCount, purchaseCount] = await Promise.all([
    InventoryMovement.countDocuments({ inventoryItemId: id }),
    RecipeVersion.countDocuments({ "recipeItems.inventoryItemId": id }),
    Purchase.countDocuments({ "purchaseItems.inventoryItemId": id }),
  ]);

  if (movementCount === 0 && recipeCount === 0 && purchaseCount === 0) {
    await InventoryItem.deleteOne({ _id: id });
    await recordAudit({ userId, action: "INVENTORY_ITEM_DELETED", entityType: "inventory_item", entityId: id, oldValue: existing });
    return { deleted: true, deactivated: false };
  }

  await InventoryItem.updateOne({ _id: id }, { active: false });
  await recordAudit({
    userId,
    action: "INVENTORY_ITEM_DEACTIVATED",
    entityType: "inventory_item",
    entityId: id,
    oldValue: existing,
    reason: `Has ${movementCount} stock movement(s), ${purchaseCount} purchase line(s) and/or ${recipeCount} recipe reference(s) — deactivated instead of deleted to preserve history.`,
  });
  return {
    deleted: false,
    deactivated: true,
    reason: "This item has real stock/purchase/recipe history, so it was hidden instead of permanently deleted, to keep that history intact.",
  };
}

export async function setInventoryItemCost(id: string, costPaisePerBase: number, reason: string, userId: string): Promise<InventoryItemRow> {
  const existing = await InventoryItem.findById(id);
  if (!existing) throw new NotFoundError("Inventory item");
  const before = toRow(existing);

  existing.avgCostPaisePerBase = costPaisePerBase;
  existing.lastPurchaseCostPaisePerBase = costPaisePerBase;
  existing.pricePending = false;
  await existing.save();

  await recordAudit({
    userId,
    action: "INVENTORY_COST_SET",
    entityType: "inventory_item",
    entityId: id,
    oldValue: { avgCostPaisePerBase: before.avg_cost_paise_per_base, pricePending: !!before.price_pending },
    newValue: { avgCostPaisePerBase: costPaisePerBase, pricePending: false },
    reason,
  });

  return toRow(existing);
}

export async function listMovements(filters: { from?: string; to?: string; itemId?: string }) {
  const query: Record<string, unknown> = {};
  if (filters.from && filters.to) query.businessDate = { $gte: filters.from, $lte: filters.to };
  if (filters.itemId) query.inventoryItemId = filters.itemId;
  const docs = await InventoryMovement.find(query).sort({ createdAt: -1 }).limit(500);
  return docs.map((m) => ({
    id: m._id,
    inventory_item_id: m.inventoryItemId,
    movement_type: m.movementType,
    direction: m.direction,
    quantity_base: m.quantityBase,
    unit_cost_paise_per_base: m.unitCostPaisePerBase,
    total_cost_paise: m.totalCostPaise,
    reference_type: m.referenceType,
    reference_id: m.referenceId,
    reason: m.reason,
    business_date: m.businessDate,
    created_by: m.createdBy,
    created_at: m.createdAt,
  }));
}
