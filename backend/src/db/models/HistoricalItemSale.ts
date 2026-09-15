import { Schema, model } from "mongoose";

export interface HistoricalItemSaleDoc {
  _id: string;
  businessDate: string;
  category: string;
  itemName: string;
  fullCount: number | null;
  halfCount: number | null;
  qtyEquivalent: number;
  notes: string | null;
  createdAt: string;
}

const schema = new Schema<HistoricalItemSaleDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true },
  category: { type: String, required: true },
  itemName: { type: String, required: true },
  fullCount: { type: Number, default: null },
  halfCount: { type: Number, default: null },
  qtyEquivalent: { type: Number, required: true, min: 0.0000001 },
  notes: { type: String, default: null },
  createdAt: { type: String, required: true },
});
schema.index({ businessDate: 1 });
schema.index({ itemName: 1 });

export const HistoricalItemSale = model<HistoricalItemSaleDoc>("HistoricalItemSale", schema);
