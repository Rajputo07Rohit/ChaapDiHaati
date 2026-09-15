import { Schema, model } from "mongoose";

export const EXPENSE_CATEGORIES = [
  "Milk",
  "Curd",
  "Vegetables",
  "Gas",
  "Coal",
  "Electricity",
  "Repair",
  "Maintenance",
  "Staff",
  "Transport",
  "Cleaning",
  "Packaging",
  "Miscellaneous",
  "Other",
] as const;

export interface ExpenseDoc {
  _id: string;
  businessDate: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  description: string;
  amountPaise: number;
  paymentMethodId: string;
  vendor: string | null;
  receiptRef: string | null;
  notes: string | null;
  status: "RECORDED" | "VOID";
  voidReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const schema = new Schema<ExpenseDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true },
  category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
  description: { type: String, required: true },
  amountPaise: { type: Number, required: true, min: 1 },
  paymentMethodId: { type: String, required: true, ref: "PaymentMethod" },
  vendor: { type: String, default: null },
  receiptRef: { type: String, default: null },
  notes: { type: String, default: null },
  status: { type: String, required: true, enum: ["RECORDED", "VOID"], default: "RECORDED" },
  voidReason: { type: String, default: null },
  createdBy: { type: String, default: null, ref: "User" },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});
schema.index({ businessDate: 1 });
schema.index({ category: 1 });

export const Expense = model<ExpenseDoc>("Expense", schema);
