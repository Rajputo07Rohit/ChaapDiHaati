import { Schema, model, Types } from "mongoose";
import { PriceType } from "./Menu";

export interface RecipeItemSub {
  _id: Types.ObjectId;
  inventoryItemId: string;
  quantityBase: number;
  wastagePct: number;
  yieldPct: number;
  optional: boolean;
}

export interface RecipeVersionDoc {
  _id: string;
  menuItemId: string;
  priceType: PriceType;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  recipeItems: RecipeItemSub[];
}

const recipeItemSchema = new Schema<RecipeItemSub>({
  inventoryItemId: { type: String, required: true, ref: "InventoryItem" },
  quantityBase: { type: Number, required: true, min: 0.0000001 },
  wastagePct: { type: Number, required: true, default: 0 },
  yieldPct: { type: Number, required: true, default: 100 },
  optional: { type: Boolean, required: true, default: false },
});

const schema = new Schema<RecipeVersionDoc>({
  _id: { type: String },
  menuItemId: { type: String, required: true, ref: "MenuItem" },
  priceType: { type: String, required: true, enum: ["HALF", "FULL", "SINGLE"] },
  version: { type: Number, required: true },
  effectiveFrom: { type: String, required: true },
  effectiveTo: { type: String, default: null },
  notes: { type: String, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
  recipeItems: { type: [recipeItemSchema], required: true, default: [] },
});
schema.index({ menuItemId: 1, priceType: 1, effectiveTo: 1 });

export const RecipeVersion = model<RecipeVersionDoc>("RecipeVersion", schema);
