import { Schema, model } from "mongoose";

export interface PurchaseItemSub {
  _id: string;
  inventoryItemId: string;
  quantity: number;
  purchaseUnit: string;
  quantityBase: number;
  ratePaise: number | null;
  amountPaise: number | null;
  pricePending: boolean;
  notes: string | null;
}

export interface PurchaseDoc {
  _id: string;
  purchaseNumber: string;
  supplierId: string | null;
  invoiceNumber: string | null;
  businessDate: string;
  paymentMethodId: string | null;
  paymentStatus: "PAID" | "CREDIT" | "PARTIAL";
  subtotalPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  amountPaidPaise: number;
  notes: string | null;
  status: "RECORDED" | "VOID";
  voidReason: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  purchaseItems: PurchaseItemSub[];
}

const purchaseItemSchema = new Schema<PurchaseItemSub>({
  _id: { type: String },
  inventoryItemId: { type: String, required: true, ref: "InventoryItem" },
  quantity: { type: Number, required: true, min: 0.0000001 },
  purchaseUnit: { type: String, required: true },
  quantityBase: { type: Number, required: true },
  ratePaise: { type: Number, default: null },
  amountPaise: { type: Number, default: null },
  pricePending: { type: Boolean, required: true, default: false },
  notes: { type: String, default: null },
});

const schema = new Schema<PurchaseDoc>({
  _id: { type: String },
  purchaseNumber: { type: String, required: true, unique: true },
  supplierId: { type: String, default: null, ref: "Supplier" },
  invoiceNumber: { type: String, default: null },
  businessDate: { type: String, required: true },
  paymentMethodId: { type: String, default: null, ref: "PaymentMethod" },
  paymentStatus: { type: String, required: true, enum: ["PAID", "CREDIT", "PARTIAL"], default: "PAID" },
  subtotalPaise: { type: Number, required: true, default: 0 },
  taxPaise: { type: Number, required: true, default: 0 },
  discountPaise: { type: Number, required: true, default: 0 },
  totalPaise: { type: Number, required: true, default: 0 },
  amountPaidPaise: { type: Number, required: true, default: 0 },
  notes: { type: String, default: null },
  status: { type: String, required: true, enum: ["RECORDED", "VOID"], default: "RECORDED" },
  voidReason: { type: String, default: null },
  createdBy: { type: String, default: null, ref: "User" },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
  purchaseItems: { type: [purchaseItemSchema], required: true, default: [] },
});
schema.index({ businessDate: 1 });
schema.index({ paymentStatus: 1 });

export const Purchase = model<PurchaseDoc>("Purchase", schema);
