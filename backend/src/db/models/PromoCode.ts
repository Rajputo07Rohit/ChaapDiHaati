import { Schema, model } from "mongoose";

export type PromoDiscountType = "FLAT" | "PERCENTAGE";

export interface PromoCodeDoc {
  _id: string;
  /** Always stored uppercase — lookups normalize the customer's input the same way. */
  code: string;
  description: string;
  discountType: PromoDiscountType;
  /** FLAT is paise; PERCENTAGE is 0-100. */
  discountValue: number;
  /** Order subtotal (paise) must be at least this before the code applies. 0 = no minimum. */
  minOrderPaise: number;
  /** Total redemptions allowed across all customers. null = unlimited. */
  usageLimit: number | null;
  usedCount: number;
  /** Redemptions allowed per customer (by phone). null = unlimited. */
  perCustomerLimit: number | null;
  active: boolean;
  /** ISO date string; null = never expires. */
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

const promoCodeSchema = new Schema<PromoCodeDoc>({
  _id: { type: String },
  code: { type: String, required: true, unique: true, uppercase: true },
  description: { type: String, required: true },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"] },
  discountValue: { type: Number, required: true, min: 0 },
  minOrderPaise: { type: Number, required: true, default: 0 },
  usageLimit: { type: Number, default: null },
  usedCount: { type: Number, required: true, default: 0 },
  perCustomerLimit: { type: Number, default: null },
  active: { type: Boolean, required: true, default: true },
  expiresAt: { type: String, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});

export const PromoCode = model<PromoCodeDoc>("PromoCode", promoCodeSchema);
