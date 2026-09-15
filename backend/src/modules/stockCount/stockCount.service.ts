import { InventoryItem, StockCount, StockCountDoc } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
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

function toRow(doc: StockCountDoc): StockCountRow {
  return {
    id: doc._id,
    business_date: doc.businessDate,
    status: doc.status,
    created_by: doc.createdBy,
    created_at: doc.createdAt,
    completed_at: doc.completedAt,
  };
}

export async function getStockCountOrThrow(id: string): Promise<StockCountRow> {
  const doc = await StockCount.findById(id);
  if (!doc) throw new NotFoundError("Stock count");
  return toRow(doc);
}

export async function getStockCountItems(stockCountId: string) {
  const doc = await StockCount.findById(stockCountId);
  if (!doc) return [];
  const itemIds = doc.stockCountItems.map((i) => i.inventoryItemId);
  const items = await InventoryItem.find({ _id: { $in: itemIds } });
  const byId = new Map(items.map((i) => [i._id, i]));
  return doc.stockCountItems.map((sci) => {
    const inv = byId.get(sci.inventoryItemId);
    return {
      id: String(sci._id),
      stock_count_id: stockCountId,
      inventory_item_id: sci.inventoryItemId,
      system_qty_base: sci.systemQtyBase,
      physical_qty_base: sci.physicalQtyBase,
      difference_base: sci.differenceBase,
      unit_cost_paise_per_base: sci.unitCostPaisePerBase,
      estimated_value_diff_paise: sci.estimatedValueDiffPaise,
      reason: sci.reason,
      notes: sci.notes,
      item_name: inv?.name ?? "",
      base_unit: inv?.baseUnit ?? "",
    };
  });
}

export async function listStockCounts(): Promise<StockCountRow[]> {
  const docs = await StockCount.find().sort({ createdAt: -1 });
  return docs.map(toRow);
}

export async function createStockCount(userId: string, categoryFilter?: string): Promise<StockCountRow> {
  const id = newId("count");
  const now = nowIso();
  const businessDate = todayBusinessDate();

  const query: Record<string, unknown> = { active: true };
  if (categoryFilter) query.category = categoryFilter;
  const items = await InventoryItem.find(query);

  await StockCount.create({
    _id: id,
    businessDate,
    status: "DRAFT",
    createdBy: userId,
    createdAt: now,
    stockCountItems: items.map((item) => ({
      _id: newId("cline"),
      inventoryItemId: item._id,
      systemQtyBase: item.currentQtyBase,
      unitCostPaisePerBase: item.avgCostPaisePerBase,
    })),
  });

  return getStockCountOrThrow(id);
}

export interface StockCountLineInput {
  inventoryItemId: string;
  physicalQtyBase: number;
  reason?: string;
  notes?: string;
}

export async function submitStockCount(stockCountId: string, lines: StockCountLineInput[], userId: string): Promise<StockCountRow> {
  const count = await StockCount.findById(stockCountId);
  if (!count) throw new NotFoundError("Stock count");
  if (count.status !== "DRAFT") throw new ConflictError("This stock count has already been completed.");

  await withTransaction(async (session) => {
    const doc = (await StockCount.findById(stockCountId).session(session))!;

    for (const line of lines) {
      if (line.physicalQtyBase < 0) throw new ValidationError("Physical quantity cannot be negative.");
      const item = await getInventoryItemOrThrow(line.inventoryItemId, session);
      const liveQty = item.current_qty_base;
      const difference = line.physicalQtyBase - liveQty;

      if (difference !== 0 && !line.reason) {
        throw new ValidationError(`A reason is required for the difference on ${item.name}.`);
      }
      if (line.reason && !REASONS.includes(line.reason)) {
        throw new ValidationError(`Invalid stock count reason: ${line.reason}`);
      }

      const estimatedValueDiff = Math.round(difference * item.avg_cost_paise_per_base);

      const sub = doc.stockCountItems.find((s) => s.inventoryItemId === line.inventoryItemId);
      if (sub) {
        sub.physicalQtyBase = line.physicalQtyBase;
        sub.differenceBase = difference;
        sub.estimatedValueDiffPaise = estimatedValueDiff;
        sub.reason = (line.reason as typeof sub.reason) ?? null;
        sub.notes = line.notes ?? null;
      }

      if (difference !== 0) {
        await recordMovement(
          {
            inventoryItemId: line.inventoryItemId,
            movementType: "STOCK_ADJUSTMENT",
            direction: difference > 0 ? "IN" : "OUT",
            quantityBase: Math.abs(difference),
            referenceType: "STOCK_COUNT",
            referenceId: stockCountId,
            reason: `${line.reason}${line.notes ? `: ${line.notes}` : ""}`,
            businessDate: count.businessDate,
            userId,
            allowNegativeStock: true,
          },
          session
        );
      }
    }

    doc.status = "COMPLETED";
    doc.completedAt = nowIso();
    await doc.save({ session });

    await recordAudit(
      { userId, action: "STOCK_COUNT_COMPLETED", entityType: "stock_count", entityId: stockCountId, newValue: { lineCount: lines.length } },
      session
    );
  });

  return getStockCountOrThrow(stockCountId);
}
