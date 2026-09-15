import { Schema, model } from "mongoose";

export type InventoryCategory = "RAW_MATERIAL" | "PACKAGING" | "DISPOSABLE" | "OTHER";
export type BaseUnit = "g" | "ml" | "piece";

export interface InventoryItemDoc {
  _id: string;
  name: string;
  category: InventoryCategory;
  baseUnit: BaseUnit;
  purchaseUnit: string;
  purchaseToBaseFactor: number;
  currentQtyBase: number;
  minStockBase: number;
  reorderLevelBase: number;
  avgCostPaisePerBase: number;
  lastPurchaseCostPaisePerBase: number | null;
  supplierId: string | null;
  pricePending: boolean;
  active: boolean;
  createdAt: string;
}

const itemSchema = new Schema<InventoryItemDoc>({
  _id: { type: String },
  name: { type: String, required: true },
  category: { type: String, required: true, enum: ["RAW_MATERIAL", "PACKAGING", "DISPOSABLE", "OTHER"] },
  baseUnit: { type: String, required: true, enum: ["g", "ml", "piece"] },
  purchaseUnit: { type: String, required: true },
  purchaseToBaseFactor: { type: Number, required: true, min: 0.0000001 },
  currentQtyBase: { type: Number, required: true, default: 0 },
  minStockBase: { type: Number, required: true, default: 0 },
  reorderLevelBase: { type: Number, required: true, default: 0 },
  avgCostPaisePerBase: { type: Number, required: true, default: 0 },
  lastPurchaseCostPaisePerBase: { type: Number, default: null },
  supplierId: { type: String, ref: "Supplier", default: null },
  pricePending: { type: Boolean, required: true, default: false },
  active: { type: Boolean, required: true, default: true },
  createdAt: { type: String, required: true },
});
itemSchema.index({ category: 1 });
itemSchema.index({ active: 1 });

export const InventoryItem = model<InventoryItemDoc>("InventoryItem", itemSchema);

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

export interface InventoryMovementDoc {
  _id: string;
  inventoryItemId: string;
  movementType: MovementType;
  direction: "IN" | "OUT";
  quantityBase: number;
  unitCostPaisePerBase: number | null;
  totalCostPaise: number | null;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  businessDate: string;
  createdBy: string | null;
  createdAt: string;
}

const movementSchema = new Schema<InventoryMovementDoc>({
  _id: { type: String },
  inventoryItemId: { type: String, required: true, ref: "InventoryItem" },
  movementType: {
    type: String,
    required: true,
    enum: ["PURCHASE", "SALE_CONSUMPTION", "WASTE", "SPOILAGE", "DAMAGE", "STOCK_ADJUSTMENT", "RETURN", "TRANSFER", "OPENING_STOCK"],
  },
  direction: { type: String, required: true, enum: ["IN", "OUT"] },
  quantityBase: { type: Number, required: true, min: 0 },
  unitCostPaisePerBase: { type: Number, default: null },
  totalCostPaise: { type: Number, default: null },
  referenceType: { type: String, default: null },
  referenceId: { type: String, default: null },
  reason: { type: String, default: null },
  businessDate: { type: String, required: true },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});
movementSchema.index({ inventoryItemId: 1 });
movementSchema.index({ movementType: 1 });
movementSchema.index({ businessDate: 1 });
movementSchema.index({ referenceType: 1, referenceId: 1 });

export const InventoryMovement = model<InventoryMovementDoc>("InventoryMovement", movementSchema);

export interface WastageRecordDoc {
  _id: string;
  inventoryMovementId: string;
  inventoryItemId: string;
  quantityBase: number;
  totalCostPaise: number;
  wastageType: "WASTE" | "SPOILAGE" | "DAMAGE";
  reason: string;
  businessDate: string;
  createdBy: string | null;
  createdAt: string;
}

const wastageSchema = new Schema<WastageRecordDoc>({
  _id: { type: String },
  inventoryMovementId: { type: String, required: true, ref: "InventoryMovement" },
  inventoryItemId: { type: String, required: true, ref: "InventoryItem" },
  quantityBase: { type: Number, required: true },
  totalCostPaise: { type: Number, required: true },
  wastageType: { type: String, required: true, enum: ["WASTE", "SPOILAGE", "DAMAGE"] },
  reason: { type: String, required: true },
  businessDate: { type: String, required: true },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});
wastageSchema.index({ businessDate: 1 });

export const WastageRecord = model<WastageRecordDoc>("WastageRecord", wastageSchema);
