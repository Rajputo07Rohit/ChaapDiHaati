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
   * Required for DELIVERY. "COD" is collected at the door; "CASHFREE" is a real
   * UPI payment verified with Cashfree; "MOCK" is a test-only paid path
   * (refused in production — see createCustomerOrder).
   */
  paymentProvider?: "MOCK" | "COD" | "CASHFREE";
  /** Required when paymentProvider is "CASHFREE" — the order created via createCashfreeCheckout, verified server-side against Cashfree before the order is accepted as paid. */
  cashfreeOrderId?: string;
  items: OrderItemInput[];
  notes?: string;
  /** Client-generated key so a retried/duplicated submit returns the existing order instead of creating another. */
  idempotencyKey?: string;
  /** Re-validated server-side against this exact order (subtotal, phone, expiry, usage limits) — never trusted as already-applied. */
  promoCode?: string;
  /** Takeaway/delivery only: whether the customer wants their plates packed (charged per half/full plate — see packingFeeFor). Older app versions don't send it, so it's never charged for them. */
  packing?: boolean;
}

/**
 * What the app sends when the customer opens online payment: the whole order
 * they're placing (saved with the payment so it can still be created — or
 * refunded — if their browser never comes back). Name/address are optional
 * only for older app versions that sent just the cart.
 */
export type CheckoutInput = Omit<CreateCustomerOrderInput, "paymentProvider" | "cashfreeOrderId">;
