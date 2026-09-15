import { Schema, model } from "mongoose";

export interface PaymentMethodDoc {
  _id: string;
  name: string;
  type: "CASH" | "ONLINE";
  active: boolean;
  sortOrder: number;
}

const schema = new Schema<PaymentMethodDoc>({
  _id: { type: String },
  name: { type: String, required: true, unique: true },
  type: { type: String, required: true, enum: ["CASH", "ONLINE"] },
  active: { type: Boolean, required: true, default: true },
  sortOrder: { type: Number, required: true, default: 0 },
});

export const PaymentMethod = model<PaymentMethodDoc>("PaymentMethod", schema);
