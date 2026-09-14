import { db } from "../../db/connection";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { getInventoryItemOrThrow, recordMovement } from "../inventory/inventory.service";

const REASONS = ["WASTE", "SPILLAGE", "UNRECORDED_CONSUMPTION", "THEFT", "COUNTING_ERROR", "OTHER"];

export interface StockCountRow {
  id: string;
  business_date: string;
  status: "DRAFT" | "COMPLETED";
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export function getStockCountOrThrow(id: string): StockCountRow {
  const row = db.prepare("SELECT * FROM stock_counts WHERE id = ?").get(id) as StockCountRow | undefined;
  if (!row) throw new NotFoundError("Stock count");
  return row;
}

export function getStockCountItems(stockCountId: string) {
  return db
    .prepare(
      `SELECT sci.*, ii.name as item_name, ii.base_unit FROM stock_count_items sci
       JOIN inventory_items ii ON ii.id = sci.inventory_item_id
       WHERE sci.stock_count_id = ?`
    )
    .all(stockCountId);
}

export function listStockCounts() {
  return db.prepare("SELECT * FROM stock_counts ORDER BY created_at DESC").all() as StockCountRow[];
}

export function createStockCount(userId: string, categoryFilter?: string): StockCountRow {
  const id = newId("count");
  const now = nowIso();
  const businessDate = todayBusinessDate();

  let sql = "SELECT * FROM inventory_items WHERE active = 1";
  const params: unknown[] = [];
  if (categoryFilter) {
    sql += " AND category = ?";
    params.push(categoryFilter);
  }
  const items = db.prepare(sql).all(...params) as { id: string; current_qty_base: number; avg_cost_paise_per_base: number }[];

  const txn = db.transaction(() => {
    db.prepare("INSERT INTO stock_counts (id, business_date, status, created_by, created_at) VALUES (?, ?, 'DRAFT', ?, ?)").run(
      id,
      businessDate,
      userId,
      now
    );
    for (const item of items) {
      db.prepare(
        `INSERT INTO stock_count_items (id, stock_count_id, inventory_item_id, system_qty_base, unit_cost_paise_per_base)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newId("cline"), id, item.id, item.current_qty_base, item.avg_cost_paise_per_base);
    }
  });
  txn();

  return getStockCountOrThrow(id);
}

export interface StockCountLineInput {
  inventoryItemId: string;
  physicalQtyBase: number;
  reason?: string;
  notes?: string;
}

export function submitStockCount(stockCountId: string, lines: StockCountLineInput[], userId: string): StockCountRow {
  const count = getStockCountOrThrow(stockCountId);
  if (count.status !== "DRAFT") throw new ConflictError("This stock count has already been completed.");

  const txn = db.transaction(() => {
    for (const line of lines) {
      if (line.physicalQtyBase < 0) throw new ValidationError("Physical quantity cannot be negative.");
      const item = getInventoryItemOrThrow(line.inventoryItemId);
      const liveQty = item.current_qty_base;
      const difference = line.physicalQtyBase - liveQty;

      if (difference !== 0 && !line.reason) {
        throw new ValidationError(`A reason is required for the difference on ${item.name}.`);
      }
      if (line.reason && !REASONS.includes(line.reason)) {
        throw new ValidationError(`Invalid stock count reason: ${line.reason}`);
      }

      const estimatedValueDiff = Math.round(difference * item.avg_cost_paise_per_base);

      db.prepare(
        `UPDATE stock_count_items SET physical_qty_base = ?, difference_base = ?, estimated_value_diff_paise = ?, reason = ?, notes = ?
         WHERE stock_count_id = ? AND inventory_item_id = ?`
      ).run(line.physicalQtyBase, difference, estimatedValueDiff, line.reason ?? null, line.notes ?? null, stockCountId, line.inventoryItemId);

      if (difference !== 0) {
        recordMovement({
          inventoryItemId: line.inventoryItemId,
          movementType: "STOCK_ADJUSTMENT",
          direction: difference > 0 ? "IN" : "OUT",
          quantityBase: Math.abs(difference),
          referenceType: "STOCK_COUNT",
          referenceId: stockCountId,
          reason: `${line.reason}${line.notes ? `: ${line.notes}` : ""}`,
          businessDate: count.business_date,
          userId,
          allowNegativeStock: true,
        });
      }
    }

    db.prepare("UPDATE stock_counts SET status = 'COMPLETED', completed_at = ? WHERE id = ?").run(nowIso(), stockCountId);

    recordAudit({
      userId,
      action: "STOCK_COUNT_COMPLETED",
      entityType: "stock_count",
      entityId: stockCountId,
      newValue: { lineCount: lines.length },
    });
  });
  txn();

  return getStockCountOrThrow(stockCountId);
}
