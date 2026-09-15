import { Schema, model } from "mongoose";

export interface StockCountItemSub {
  _id: string;
  inventoryItemId: string;
  systemQtyBase: number;
  physicalQtyBase: number | null;
  differenceBase: number | null;
  unitCostPaisePerBase: number | null;
  estimatedValueDiffPaise: number | null;
  reason: "WASTE" | "SPILLAGE" | "UNRECORDED_CONSUMPTION" | "THEFT" | "COUNTING_ERROR" | "OTHER" | null;
  notes: string | null;
}

export interface StockCountDoc {
  _id: string;
  businessDate: string;
  status: "DRAFT" | "COMPLETED";
  createdBy: string | null;
  createdAt: string;
  completedAt: string | null;
  stockCountItems: StockCountItemSub[];
}

const itemSchema = new Schema<StockCountItemSub>({
  _id: { type: String },
  inventoryItemId: { type: String, required: true, ref: "InventoryItem" },
  systemQtyBase: { type: Number, required: true },
  physicalQtyBase: { type: Number, default: null },
  differenceBase: { type: Number, default: null },
  unitCostPaisePerBase: { type: Number, default: null },
  estimatedValueDiffPaise: { type: Number, default: null },
  reason: {
    type: String,
    enum: ["WASTE", "SPILLAGE", "UNRECORDED_CONSUMPTION", "THEFT", "COUNTING_ERROR", "OTHER", null],
    default: null,
  },
  notes: { type: String, default: null },
});

const schema = new Schema<StockCountDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true },
  status: { type: String, required: true, enum: ["DRAFT", "COMPLETED"], default: "DRAFT" },
  createdBy: { type: String, default: null, ref: "User" },
  createdAt: { type: String, required: true },
  completedAt: { type: String, default: null },
  stockCountItems: { type: [itemSchema], required: true, default: [] },
});
schema.index({ businessDate: 1 });

export const StockCount = model<StockCountDoc>("StockCount", schema);
