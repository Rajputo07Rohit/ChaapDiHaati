import { Schema, model } from "mongoose";

/**
 * One online-payment attempt, saved the moment the customer opens Cashfree —
 * with the whole order they were placing. If the browser never comes back to
 * create the order (phone died, tab closed, UPI app opened in another browser),
 * the webhook or the background reconciler finds the PAID payment here and
 * either creates the order from it or refunds the money. A payment can never
 * be taken without ending up as an order or a refund.
 */
export type CheckoutStatus = "PENDING" | "COMPLETED" | "CANCELLED" | "REFUNDED" | "REFUND_FAILED";

export interface CheckoutSessionDoc {
  _id: string; // the Cashfree order id
  phone: string;
  /** The CreateCustomerOrderInput the customer was placing (no payment fields). */
  input: Record<string, unknown>;
  amountPaise: number;
  status: CheckoutStatus;
  orderId: string | null;
  refundId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const checkoutSchema = new Schema<CheckoutSessionDoc>({
  _id: { type: String },
  phone: { type: String, required: true },
  input: { type: Schema.Types.Mixed, required: true },
  amountPaise: { type: Number, required: true },
  status: { type: String, required: true, enum: ["PENDING", "COMPLETED", "CANCELLED", "REFUNDED", "REFUND_FAILED"], default: "PENDING" },
  orderId: { type: String, default: null },
  refundId: { type: String, default: null },
  note: { type: String, default: null },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});
checkoutSchema.index({ status: 1, createdAt: 1 });

export const CheckoutSession = model<CheckoutSessionDoc>("CheckoutSession", checkoutSchema);

/** A browser's Web Push subscription, tied to the verified phone that made it. */
export interface PushSubscriptionDoc {
  _id: string; // the push endpoint URL
  phone: string;
  p256dh: string;
  auth: string;
  createdAt: string;
}

const pushSchema = new Schema<PushSubscriptionDoc>({
  _id: { type: String },
  phone: { type: String, required: true },
  p256dh: { type: String, required: true },
  auth: { type: String, required: true },
  createdAt: { type: String, required: true },
});
pushSchema.index({ phone: 1 });

export const PushSubscription = model<PushSubscriptionDoc>("PushSubscription", pushSchema);

/** What a returning customer shouldn't have to type again: their name and recent delivery addresses. */
export interface SavedAddress {
  _id: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  lastUsedAt: string;
}

export interface CustomerProfileDoc {
  _id: string; // the verified phone (+91…)
  name: string | null;
  addresses: SavedAddress[];
  /** Opted in to order updates on WhatsApp. */
  whatsappOptIn: boolean;
  updatedAt: string;
}

const addressSchema = new Schema<SavedAddress>({
  _id: { type: String },
  address: { type: String, required: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  lastUsedAt: { type: String, required: true },
});

const profileSchema = new Schema<CustomerProfileDoc>({
  _id: { type: String },
  name: { type: String, default: null },
  addresses: { type: [addressSchema], required: true, default: [] },
  whatsappOptIn: { type: Boolean, required: true, default: true },
  updatedAt: { type: String, required: true },
});

export const CustomerProfile = model<CustomerProfileDoc>("CustomerProfile", profileSchema);

/** The customer's private rating of one order — reaches the owner, not Google. */
export interface OrderFeedbackDoc {
  _id: string; // the order id (one rating per order)
  orderNumber: number;
  phone: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

const feedbackSchema = new Schema<OrderFeedbackDoc>({
  _id: { type: String },
  orderNumber: { type: Number, required: true },
  phone: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: null },
  createdAt: { type: String, required: true },
});
feedbackSchema.index({ createdAt: -1 });

export const OrderFeedback = model<OrderFeedbackDoc>("OrderFeedback", feedbackSchema);

/**
 * Which phone an OTP was sent to. Verification checks the code against THIS
 * phone — never one the browser names at verify time — so a code received on
 * one number can't sign anyone in as another. Expires on its own after 15 min.
 */
export interface OtpSessionDoc {
  _id: string; // 2Factor session id
  phone: string;
  channel: "SMS" | "VOICE";
  attempts: number;
  expiresAt: Date;
}

const otpSchema = new Schema<OtpSessionDoc>({
  _id: { type: String },
  phone: { type: String, required: true },
  channel: { type: String, required: true, enum: ["SMS", "VOICE"] },
  attempts: { type: Number, required: true, default: 0 },
  expiresAt: { type: Date, required: true },
});
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const OtpSession = model<OtpSessionDoc>("OtpSession", otpSchema);
