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
export type PriceType = "HALF" | "FULL" | "SINGLE";
export type DiscountType = "FLAT" | "PERCENTAGE";

export interface OrderItemInput {
  menuItemId: string;
  priceType: PriceType;
  quantity: number;
  specialInstructions?: string;
  /** Per-item discount. FLAT is paise; PERCENTAGE is 0-100. Defaults to no discount. */
  discountType?: DiscountType;
  discountValue?: number;
}

export interface CreateOrderInput {
  orderType: OrderType;
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  items: OrderItemInput[];
  /** Order-level discount, applied on top of (subtotal - item discounts). FLAT is paise; PERCENTAGE is 0-100. */
  discountType?: DiscountType;
  discountValue?: number;
  discountReason?: string;
  notes?: string;
  businessDate?: string;
  asDraft?: boolean;
}

export interface PaymentInput {
  paymentMethodId: string;
  amountPaise: number;
  reference?: string;
}

export interface CompleteOrderInput {
  payments: PaymentInput[];
  allowNegativeStock?: boolean;
  overrideReason?: string;
  /** Set after staff confirms an INVENTORY_ITEMS_MISSING error — completes the order anyway, skipping the ingredients whose inventory record is missing. */
  bypassMissingInventory?: boolean;
}
