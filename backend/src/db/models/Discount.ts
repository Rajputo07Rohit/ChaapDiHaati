import { Schema, model } from "mongoose";
import { DiscountType } from "./Order";

/**
 * An admin-defined, reusable discount rule scoped to specific menu items
 * and/or whole categories (e.g. "10% off Bread", "10% off Chaap Rolls").
 * Staff apply/remove these from the POS cart per order — this only defines
 * what's available to apply, it never touches an order by itself.
 */
export interface DiscountRuleDoc {
  _id: string;
  name: string;
  menuItemIds: string[];
  categoryIds: string[];
  discountType: DiscountType;
  discountValue: number; // PERCENTAGE: 0-100; FLAT: paise
  active: boolean;
  createdBy: string;
  createdAt: string;
}

const discountRuleSchema = new Schema<DiscountRuleDoc>({
  _id: { type: String },
  name: { type: String, required: true },
  menuItemIds: { type: [String], required: true, default: [] },
  categoryIds: { type: [String], required: true, default: [] },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"] },
  discountValue: { type: Number, required: true, min: 0 },
  active: { type: Boolean, required: true, default: true },
  createdBy: { type: String, required: true, ref: "User" },
  createdAt: { type: String, required: true },
});
discountRuleSchema.index({ active: 1 });

export const DiscountRule = model<DiscountRuleDoc>("DiscountRule", discountRuleSchema);
