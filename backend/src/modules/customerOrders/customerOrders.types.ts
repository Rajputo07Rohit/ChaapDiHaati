import { OrderItemInput } from "../orders/orders.types";

export interface CreateCustomerOrderInput {
  // DELIVERY is accepted here so createCustomerOrder can reject it with a
  // friendly "coming soon" message instead of the route rejecting it blind.
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  /** Required for DELIVERY (so the rider knows who they're handing the order to); optional for dine-in/takeaway, just a convenience for staff. */
  customerName?: string;
  /** Free-text table number/label the customer types in at checkout — no table registry, just a note for staff. */
  tableLabel?: string;
  /** Required for DELIVERY. */
  deliveryAddress?: string;
  /** Optional — from the browser's geolocation, lets the rider navigate directly instead of a text-address search. */
  deliveryLatitude?: number;
  deliveryLongitude?: number;
  /**
   * Required for DELIVERY. "MOCK" is a placeholder online-payment path for
   * testing before PhonePe is wired up (blocked in production — see
   * createCustomerOrder); "COD" is real, collected at the door; "RAZORPAY"
   * is a real Razorpay checkout running in test mode.
   */
  paymentProvider?: "MOCK" | "COD" | "RAZORPAY";
  /** Required when paymentProvider is "RAZORPAY" — identifies the order created via createRazorpayOrder and the payment to verify against it. */
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  razorpaySignature?: string;
  items: OrderItemInput[];
  notes?: string;
  /** Client-generated key so a retried/duplicated submit returns the existing order instead of creating another. */
  idempotencyKey?: string;
}

export interface CreateRazorpayOrderInput {
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
  items: OrderItemInput[];
}
