import { OrderType, PriceType } from "../api/types";

/** The single source of truth for how a price type reads on a printed
 * receipt, a WhatsApp bill, or anywhere else a line item is shown outside
 * the Menu page — which has the real per-item labels (half_label/full_label).
 * A sales order only snapshots the price_type enum, not that label text, so
 * every consumer of historical order data falls back to this same mapping —
 * keeping receipt and WhatsApp bill text identical for the same order. */
const PRICE_TYPE_LABEL: Record<PriceType, string> = { HALF: "Half", FULL: "Full", SINGLE: "" };

export function priceTypeLabelFor(priceType: PriceType): string {
  return PRICE_TYPE_LABEL[priceType] ?? "";
}

export function orderTypeLabelFor(orderType: OrderType): string {
  return orderType.replace("_", "-");
}
