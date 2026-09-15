import { Schema, model } from "mongoose";

export interface CashTransactionDoc {
  _id: string;
  businessDate: string;
  txnType: "OPENING" | "SALE" | "EXPENSE" | "PURCHASE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT" | "REFUND";
  direction: "IN" | "OUT";
  amountPaise: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

const cashSchema = new Schema<CashTransactionDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true },
  txnType: { type: String, required: true, enum: ["OPENING", "SALE", "EXPENSE", "PURCHASE", "WITHDRAWAL", "DEPOSIT", "ADJUSTMENT", "REFUND"] },
  direction: { type: String, required: true, enum: ["IN", "OUT"] },
  amountPaise: { type: Number, required: true, min: 0 },
  referenceType: { type: String, default: null },
  referenceId: { type: String, default: null },
  reason: { type: String, default: null },
  createdBy: { type: String, default: null, ref: "User" },
  createdAt: { type: String, required: true },
});
cashSchema.index({ businessDate: 1 });
cashSchema.index({ txnType: 1 });

export const CashTransaction = model<CashTransactionDoc>("CashTransaction", cashSchema);

export interface BankTransactionDoc {
  _id: string;
  businessDate: string;
  txnType: "CREDIT" | "DEBIT";
  amountPaise: number;
  description: string;
  reference: string | null;
  category: "BUSINESS" | "PERSONAL" | "TRANSFER" | "SUPPLIER" | "SALARY" | "REPAIR" | "UNKNOWN";
  paymentMethodId: string | null;
  linkedReferenceType: string | null;
  linkedReferenceId: string | null;
  reconciled: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

const bankSchema = new Schema<BankTransactionDoc>({
  _id: { type: String },
  businessDate: { type: String, required: true },
  txnType: { type: String, required: true, enum: ["CREDIT", "DEBIT"] },
  amountPaise: { type: Number, required: true, min: 1 },
  description: { type: String, required: true },
  reference: { type: String, default: null },
  category: {
    type: String,
    required: true,
    enum: ["BUSINESS", "PERSONAL", "TRANSFER", "SUPPLIER", "SALARY", "REPAIR", "UNKNOWN"],
    default: "UNKNOWN",
  },
  paymentMethodId: { type: String, default: null, ref: "PaymentMethod" },
  linkedReferenceType: { type: String, default: null },
  linkedReferenceId: { type: String, default: null },
  reconciled: { type: Boolean, required: true, default: false },
  notes: { type: String, default: null },
  createdBy: { type: String, default: null, ref: "User" },
  createdAt: { type: String, required: true },
});
bankSchema.index({ businessDate: 1 });
bankSchema.index({ reconciled: 1 });
bankSchema.index({ category: 1 });

export const BankTransaction = model<BankTransactionDoc>("BankTransaction", bankSchema);
