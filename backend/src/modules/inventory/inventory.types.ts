export type InventoryCategory = "RAW_MATERIAL" | "PACKAGING" | "DISPOSABLE" | "OTHER";
export type BaseUnit = "g" | "ml" | "piece";

export type MovementType =
  | "PURCHASE"
  | "SALE_CONSUMPTION"
  | "WASTE"
  | "SPOILAGE"
  | "DAMAGE"
  | "STOCK_ADJUSTMENT"
  | "RETURN"
  | "TRANSFER"
  | "OPENING_STOCK";

export type Direction = "IN" | "OUT";

export type StockStatus = "OUT_OF_STOCK" | "CRITICAL" | "LOW" | "HEALTHY";

export interface InventoryItemRow {
  id: string;
  name: string;
  category: InventoryCategory;
  base_unit: BaseUnit;
  purchase_unit: string;
  purchase_to_base_factor: number;
  current_qty_base: number;
  min_stock_base: number;
  reorder_level_base: number;
  avg_cost_paise_per_base: number;
  last_purchase_cost_paise_per_base: number | null;
  supplier_id: string | null;
  price_pending: number;
  active: number;
  created_at: string;
}

// Movements that increase weighted-average cost when they bring stock IN
// with a known price. Movements outside this set consume at current avg cost.
export const COST_UPDATING_IN_TYPES: MovementType[] = ["PURCHASE", "OPENING_STOCK", "STOCK_ADJUSTMENT"];
