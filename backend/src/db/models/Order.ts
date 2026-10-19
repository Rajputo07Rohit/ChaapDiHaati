import { Schema, model } from "mongoose";
import { PriceType } from "./Menu";

export type OrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "ONLINE";
export type OrderStatus =
  | "DRAFT"
  | "PENDING_ACCEPTANCE"
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
/** Where an automatic online (gateway) refund stands. Null = no gateway refund needed. */
export type GatewayRefundStatus = "PENDING" | "SUCCESS" | "FAILED";

/** A snapshot of a selected add-on (e.g. "Extra Cheese") at order time —
 * independent of the MenuItem's current addons list, so editing/removing an
 * addon later never changes what a past order shows it charged for. */
export interface OrderItemAddonSub {
  _id: string;
  name: string;
  unitPricePaise: number;
}

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
  /** Selected add-ons (e.g. extra cream/cheese), charged per unit ordered. Empty for items with none selected. */
  addons: OrderItemAddonSub[];
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
  /** When packing finished (handed over / sent out). Null = still waiting on the Packing board. */
  packedAt: string | null;
  /** When the kitchen tapped Ready. */
  kitchenReadyAt: string | null;
  /** When kitchen staff cleared the ready ticket off the board (Remove). */
  kitchenRemovedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  /** Only ever set for customer self-ordered DELIVERY, from the browser's geolocation — lets the rider open turn-by-turn navigation instead of a text-address search. */
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  assignedRiderId: string | null;
  subtotalPaise: number;
  discountPaise: number;
  discountType: DiscountType;
  discountValue: number;
  itemDiscountTotalPaise: number;
  discountReason: string | null;
  /** The promo code redeemed for this order's discount, if any (customer self-order only). Kept separately from discountReason so usage limits can be enforced by querying it directly. */
  promoCode: string | null;
  /** Only ever non-zero for customer self-ordered DELIVERY (tiered by subtotal, computed server-side). Staff-created orders always default to 0. */
  deliveryFeePaise: number;
  /** Only ever non-zero for customer self-ordered takeaway/delivery where the customer kept packing on (₹5/half, ₹9/full plate). */
  packingFeePaise: number;
  netTotalPaise: number;
  cancelReason: string | null;
  notes: string | null;
  stockOverride: boolean;
  /** Client-generated key for the customer self-order flow — a retried/duplicated POST with the same key returns the existing order instead of creating a second one. Null for staff-created orders. */
  clientIdempotencyKey: string | null;
  /** Gateway order id of the online payment that paid for this order (e.g. the Cashfree order id). Unique, so one payment can never pay for two orders. */
  paymentRef: string | null;
  /** Automatic refund of an online (Cashfree) payment when a paid order is cancelled. */
  refundStatus: GatewayRefundStatus | null;
  refundId: string | null;
  refundAmountPaise: number | null;
  refundInitiatedAt: string | null;
  refundUpdatedAt: string | null;
  refundAttempts: number;
  refundError: string | null;
  createdBy: string | null;
  confirmedAt: string | null;
  /** Prep-time estimate (minutes) chosen by staff when accepting a self-order; drives the customer's ETA. */
  prepTimeMinutes: number | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: OrderItemSub[];
  payments: OrderPaymentSub[];
  discounts: OrderDiscountSub[];
}

const itemAddonSchema = new Schema<OrderItemAddonSub>({
  _id: { type: String },
  name: { type: String, required: true },
  unitPricePaise: { type: Number, required: true, min: 0 },
});

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
  addons: { type: [itemAddonSchema], required: true, default: [] },
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
    enum: ["DRAFT", "PENDING_ACCEPTANCE", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"],
    default: "DRAFT",
  },
  paymentStatus: { type: String, required: true, enum: ["UNPAID", "PARTIAL", "PAID", "REFUNDED"], default: "UNPAID" },
  kitchenStatus: { type: String, required: true, enum: ["PENDING", "READY"], default: "PENDING" },
  packedAt: { type: String, default: null },
  kitchenReadyAt: { type: String, default: null },
  kitchenRemovedAt: { type: String, default: null },
  customerName: { type: String, default: null },
  customerPhone: { type: String, default: null },
  deliveryAddress: { type: String, default: null },
  deliveryLatitude: { type: Number, default: null },
  deliveryLongitude: { type: Number, default: null },
  assignedRiderId: { type: String, default: null, ref: "User" },
  subtotalPaise: { type: Number, required: true, default: 0 },
  discountPaise: { type: Number, required: true, default: 0 },
  discountType: { type: String, required: true, enum: ["FLAT", "PERCENTAGE"], default: "FLAT" },
  discountValue: { type: Number, required: true, default: 0 },
  itemDiscountTotalPaise: { type: Number, required: true, default: 0 },
  deliveryFeePaise: { type: Number, required: true, default: 0 },
  packingFeePaise: { type: Number, required: true, default: 0 },
  discountReason: { type: String, default: null },
  promoCode: { type: String, default: null },
  netTotalPaise: { type: Number, required: true, default: 0 },
  cancelReason: { type: String, default: null },
  notes: { type: String, default: null },
  stockOverride: { type: Boolean, required: true, default: false },
  // No `default: null` here on purpose — a sparse unique index only excludes
  // documents where the field is actually absent, not ones where it's set
  // to null. Staff-created orders (which never pass this) must leave the
  // field entirely unset, or every one of them would collide on `null`.
  clientIdempotencyKey: { type: String },
  paymentRef: { type: String },
  refundStatus: { type: String, enum: ["PENDING", "SUCCESS", "FAILED", null], default: null },
  refundId: { type: String, default: null },
  refundAmountPaise: { type: Number, default: null },
  refundInitiatedAt: { type: String, default: null },
  refundUpdatedAt: { type: String, default: null },
  refundAttempts: { type: Number, required: true, default: 0 },
  refundError: { type: String, default: null },
  createdBy: { type: String, default: null, ref: "User" },
  confirmedAt: { type: String, default: null },
  prepTimeMinutes: { type: Number, default: null },
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
orderSchema.index({ clientIdempotencyKey: 1 }, { unique: true, sparse: true });
orderSchema.index({ paymentRef: 1 }, { unique: true, sparse: true });
orderSchema.index({ promoCode: 1, customerPhone: 1 });
// Customer order history: filter by phone, newest first.
orderSchema.index({ customerPhone: 1, createdAt: -1 });
// Staff order list filtered by status, newest first.
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ kitchenStatus: 1, createdAt: 1 });
orderSchema.index({ refundStatus: 1 });

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
