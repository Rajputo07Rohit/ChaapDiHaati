import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { ValidationError, NotFoundError } from "../../utils/errors";
import {
  COST_UPDATING_IN_TYPES,
  Direction,
  InventoryItemRow,
  MovementType,
  StockStatus,
} from "./inventory.types";

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

const getItemStmt = db.prepare("SELECT * FROM inventory_items WHERE id = ?");
const updateItemStockStmt = db.prepare(
  `UPDATE inventory_items SET current_qty_base = ?, avg_cost_paise_per_base = ?,
     last_purchase_cost_paise_per_base = COALESCE(?, last_purchase_cost_paise_per_base),
     price_pending = CASE WHEN ? THEN 0 ELSE price_pending END
   WHERE id = ?`
);
const insertMovementStmt = db.prepare(`
  INSERT INTO inventory_movements
    (id, inventory_item_id, movement_type, direction, quantity_base, unit_cost_paise_per_base,
     total_cost_paise, reference_type, reference_id, reason, business_date, created_by, created_at)
  VALUES
    (@id, @inventoryItemId, @movementType, @direction, @quantityBase, @unitCostPaisePerBase,
     @totalCostPaise, @referenceType, @referenceId, @reason, @businessDate, @createdBy, @createdAt)
`);
const insertWastageStmt = db.prepare(`
  INSERT INTO wastage_records
    (id, inventory_movement_id, inventory_item_id, quantity_base, total_cost_paise, wastage_type, reason, business_date, created_by, created_at)
  VALUES
    (@id, @movementId, @inventoryItemId, @quantityBase, @totalCostPaise, @wastageType, @reason, @businessDate, @createdBy, @createdAt)
`);

export function getInventoryItemOrThrow(id: string): InventoryItemRow {
  const item = getItemStmt.get(id) as InventoryItemRow | undefined;
  if (!item) throw new NotFoundError("Inventory item");
  return item;
}

/**
 * Records one stock movement and updates the cached current_qty_base /
 * avg_cost_paise_per_base on inventory_items. Must be called inside a
 * db.transaction() by the caller — this function does not open its own.
 */
export function recordMovement(input: RecordMovementInput): MovementResult {
  const item = getInventoryItemOrThrow(input.inventoryItemId);
  if (input.quantityBase < 0) throw new ValidationError("Movement quantity cannot be negative.");
  if (input.quantityBase === 0) throw new ValidationError("Movement quantity must be greater than zero.");

  const signedDelta = input.direction === "IN" ? input.quantityBase : -input.quantityBase;
  const resultingQty = item.current_qty_base + signedDelta;
  const wentNegative = resultingQty < 0;

  if (wentNegative && !input.allowNegativeStock) {
    throw new ValidationError(
      `Insufficient stock for ${item.name}: have ${item.current_qty_base}${item.base_unit}, need ${input.quantityBase}${item.base_unit}. Admin override required to proceed.`
    );
  }

  let newAvgCost = item.avg_cost_paise_per_base;
  let unitCostForMovement = input.unitCostPaisePerBase ?? null;
  let lastPurchaseCost: number | null = null;
  // A real, known cost has just arrived for this item — it is no longer
  // "PRICE PENDING" even if it was created that way, or was purchased
  // earlier with an unconfirmed price.
  let clearsPricePending = false;

  if (input.direction === "IN") {
    if (COST_UPDATING_IN_TYPES.includes(input.movementType) && input.unitCostPaisePerBase != null) {
      const existingValue = item.current_qty_base * item.avg_cost_paise_per_base;
      const incomingValue = input.quantityBase * input.unitCostPaisePerBase;
      const totalQty = item.current_qty_base + input.quantityBase;
      newAvgCost = totalQty > 0 ? (existingValue + incomingValue) / totalQty : input.unitCostPaisePerBase;
      if (input.movementType === "PURCHASE") lastPurchaseCost = input.unitCostPaisePerBase;
      clearsPricePending = true;
    } else if (unitCostForMovement == null) {
      unitCostForMovement = item.avg_cost_paise_per_base;
    }
  } else {
    // OUT movements are valued at current weighted-average cost; average is unchanged.
    unitCostForMovement = item.avg_cost_paise_per_base;
  }

  const totalCostPaise =
    unitCostForMovement != null ? Math.round(unitCostForMovement * input.quantityBase) : null;

  const movementId = newId("mov");
  insertMovementStmt.run({
    id: movementId,
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
    createdAt: nowIso(),
  });

  updateItemStockStmt.run(resultingQty, newAvgCost, lastPurchaseCost, clearsPricePending ? 1 : 0, item.id);

  if (["WASTE", "SPOILAGE", "DAMAGE"].includes(input.movementType)) {
    insertWastageStmt.run({
      id: newId("waste"),
      movementId,
      inventoryItemId: item.id,
      quantityBase: input.quantityBase,
      totalCostPaise: totalCostPaise ?? 0,
      wastageType: input.movementType,
      reason: input.reason ?? "Not specified",
      businessDate: input.businessDate,
      createdBy: input.userId,
      createdAt: nowIso(),
    });
  }

  if (wentNegative) {
    recordAudit({
      userId: input.userId,
      action: "NEGATIVE_STOCK_OVERRIDE",
      entityType: "inventory_item",
      entityId: item.id,
      oldValue: { qty: item.current_qty_base },
      newValue: { qty: resultingQty },
      reason: input.reason,
    });
  }

  return { movementId, totalCostPaise, resultingQtyBase: resultingQty, wentNegative };
}

export function stockStatusOf(item: InventoryItemRow): StockStatus {
  if (item.current_qty_base <= 0) return "OUT_OF_STOCK";
  if (item.current_qty_base <= item.min_stock_base) return "CRITICAL";
  if (item.current_qty_base <= item.reorder_level_base) return "LOW";
  return "HEALTHY";
}

export function listInventoryItems(filters: { category?: string; active?: boolean } = {}) {
  let sql = "SELECT * FROM inventory_items WHERE 1=1";
  const params: unknown[] = [];
  if (filters.category) {
    sql += " AND category = ?";
    params.push(filters.category);
  }
  if (filters.active !== undefined) {
    sql += " AND active = ?";
    params.push(filters.active ? 1 : 0);
  }
  sql += " ORDER BY name ASC";
  const rows = db.prepare(sql).all(...params) as InventoryItemRow[];
  return rows.map((r) => ({ ...r, stockStatus: stockStatusOf(r) }));
}

export function getStockValuePaise(): number {
  const row = db
    .prepare("SELECT SUM(current_qty_base * avg_cost_paise_per_base) as total FROM inventory_items WHERE active = 1")
    .get() as { total: number | null };
  return Math.round(row.total ?? 0);
}

export function getLowStockItems() {
  return listInventoryItems({ active: true }).filter((i) => i.stockStatus !== "HEALTHY");
}
