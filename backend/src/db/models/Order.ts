import { Schema, model } from "mongoose";
import { PriceType } from "./Menu";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
export type OrderStatus =
  | "DRAFT"
  | "CONFIRMED"
  | "PREPARING"
  | "READY"
  | "OUT_FOR_DELIVERY"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "REFUNDED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
export type DiscountType = "FLAT" | "PERCENTAGE";
/**
 * Whether the kitchen has finished preparing this order — deliberately
 * independent of `status`/`paymentStatus`. Counter sales complete (paid,
 * stock deducted) the instant they're rung up, well before the food is
 * actually cooked, so kitchen prep can't be tracked by the main order
 * lifecycle; this is a separate, purely informational flag every order
 * gets regardless of type, so the kitchen/orders screens can show "still
 * cooking" vs "ready" without touching payment or completion at all.
 */
export type KitchenStatus = "PENDING" | "READY";

export interface OrderItemSub {
  _id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  categoryName: string | null;
  priceType: PriceType;
  unitPricePaise: number;
  quantity: number;
  lineSubtotalPaise: number;
  recipeVersionId: string | null;
  cogsPaise: number | null;
  specialInstructions: string | null;
  status: "ACTIVE" | "CANCELLED";
  discountPaise: number;
  discountType: DiscountType;
  discountValue: number;
  lineNetPaise: number;
  createdAt: string;
}

export interface OrderPaymentSub {
  _id: string;
  paymentMethodId: string;
  amountPaise: number;
  reference: string | null;
  status: "ACTIVE" | "VOIDED";
  createdBy: string | null;
  createdAt: string;
}

export interface OrderDiscountSub {
  _id: string;
  salesOrderItemId: string | null;
  amountPaise: number;
  discountType: DiscountType;
  discountValue: number;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface OrderDoc {
  _id: string;
  orderNumber: number;
  businessDate: string;
  orderType: OrderType;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  kitchenStatus: KitchenStatus;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  assignedRiderId: string | null;
  subtotalPaise: number;
  discountPaise: number;
  discountType: DiscountType;
  discountValue: number;
  itemDiscountTotalPaise: number;
  discountReason: string | null;
  netTotalPaise: number;
  cancelReason: string | null;
  notes: string | null;
  stockOverride: boolean;
  createdBy: string | null;
  confirmedAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemSub[];
  payments: OrderPaymentSub[];
  discounts: OrderDiscountSub[];
}

const itemSchema = new Schema<OrderItemSub>({
  _id: { type: String },
  menuItemId: { type: String, required: true, ref: "MenuItem" },
  itemNameSnapshot: { type: String, required: true },
  categoryName: { type: String, default: null },
  priceType: { type: String, required: true, enum: ["HALF", "FULL", "SINGLE"] },
  unitPricePaise: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  lineSubtotalPaise: { type: Number, required: true },
  recipeVersionId: { type: String, default: null, ref: "RecipeVersion" },
  cogsPaise: { type: Number, default: null },
  specialInstructions: { type: String, default: null },
  status: { type: String, required: true, enum: ["ACTIVE", "CANCELLED"], default: "ACTIVE" },
  discountPaise: { type: Number, required: true, default: 0 },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"], default: "FLAT" },
  discountValue: { type: Number, required: true, default: 0 },
  lineNetPaise: { type: Number, required: true, default: 0 },
  createdAt: { type: String, required: true },
});

const paymentSchema = new Schema<OrderPaymentSub>({
  _id: { type: String },
  paymentMethodId: { type: String, required: true, ref: "PaymentMethod" },
  amountPaise: { type: Number, required: true, min: 1 },
  reference: { type: String, default: null },
  status: { type: String, required: true, enum: ["ACTIVE", "VOIDED"], default: "ACTIVE" },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});

const discountSchema = new Schema<OrderDiscountSub>({
  _id: { type: String },
  salesOrderItemId: { type: String, default: null },
  amountPaise: { type: Number, required: true, min: 0 },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"], default: "FLAT" },
  discountValue: { type: Number, required: true, default: 0 },
  reason: { type: String, default: null },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});

const orderSchema = new Schema<OrderDoc>({
  _id: { type: String },
  orderNumber: { type: Number, required: true, unique: true },
  businessDate: { type: String, required: true },
  orderType: { type: String, required: true, enum: ["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"] },
  status: {
    type: String,
    required: true,
    enum: ["DRAFT", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"],
    default: "DRAFT",
  },
  paymentStatus: { type: String, required: true, enum: ["UNPAID", "PARTIAL", "PAID", "REFUNDED"], default: "UNPAID" },
  kitchenStatus: { type: String, required: true, enum: ["PENDING", "READY"], default: "PENDING" },
  customerName: { type: String, default: null },
  customerPhone: { type: String, default: null },
  deliveryAddress: { type: String, default: null },
  assignedRiderId: { type: String, default: null, ref: "User" },
  subtotalPaise: { type: Number, required: true, default: 0 },
  discountPaise: { type: Number, required: true, default: 0 },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"], default: "FLAT" },
  discountValue: { type: Number, required: true, default: 0 },
  itemDiscountTotalPaise: { type: Number, required: true, default: 0 },
  discountReason: { type: String, default: null },
  netTotalPaise: { type: Number, required: true, default: 0 },
  cancelReason: { type: String, default: null },
  notes: { type: String, default: null },
  stockOverride: { type: Boolean, required: true, default: false },
  createdBy: { type: String, default: null, ref: "User" },
  confirmedAt: { type: String, default: null },
  deliveredAt: { type: String, default: null },
  completedAt: { type: String, default: null },
  cancelledAt: { type: String, default: null },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
  items: { type: [itemSchema], required: true, default: [] },
  payments: { type: [paymentSchema], required: true, default: [] },
  discounts: { type: [discountSchema], required: true, default: [] },
});
orderSchema.index({ businessDate: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ assignedRiderId: 1 });
orderSchema.index({ createdAt: -1 });

export const Order = model<OrderDoc>("Order", orderSchema);

export interface RefundDoc {
  _id: string;
  salesOrderId: string;
  amountPaise: number;
  refundType: "FULL" | "PARTIAL";
  reason: string;
  paymentMethodId: string;
  createdBy: string | null;
  createdAt: string;
}

const refundSchema = new Schema<RefundDoc>({
  _id: { type: String },
  salesOrderId: { type: String, required: true, ref: "Order" },
  amountPaise: { type: Number, required: true, min: 1 },
  refundType: { type: String, required: true, enum: ["FULL", "PARTIAL"] },
  reason: { type: String, required: true },
  paymentMethodId: { type: String, required: true, ref: "PaymentMethod" },
  createdBy: { type: String, default: null },
  createdAt: { type: String, required: true },
});
refundSchema.index({ salesOrderId: 1 });

export const Refund = model<RefundDoc>("Refund", refundSchema);
