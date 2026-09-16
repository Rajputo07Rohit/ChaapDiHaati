import { OrderType, PaymentMethod } from "../api/types";

/**
 * An ONLINE order almost always means the customer already paid digitally
 * (UPI/Zomato/Swiggy), so default the payment picker to the first ONLINE-
 * type method instead of Cash (methods[0], sorted first) — staff can still
 * switch it, but the common case shouldn't require remembering to.
 */
export function defaultPaymentMethodId(orderType: OrderType, methods: PaymentMethod[]): string {
  if (orderType === "ONLINE") {
    const online = methods.find((m) => m.type === "ONLINE");
    if (online) return online.id;
  }
  return methods[0]?.id ?? "";
}
