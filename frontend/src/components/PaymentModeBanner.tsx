import { Banknote, CheckCircle2, Store } from "lucide-react";
import { SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";

/** Customer-checkout notes get a system prefix ("Cash on Delivery — …",
 * "[Paid via Razorpay — TEST MODE] …") that records the payment mode. That's
 * shown in the payment banner now, so it's stripped here to leave only what
 * the customer actually typed. */
export function customerNoteOf(notes: string | null | undefined): string {
  if (!notes) return "";
  return notes
    .replace(/^\[TEST PAYMENT[^\]]*\]\s*/i, "")
    .replace(/^\[Paid via Razorpay[^\]]*\]\s*/i, "")
    .replace(/^Cash on Delivery(\s*[—-]\s*)?/i, "")
    .trim();
}

export function paymentSummary(order: SalesOrder) {
  const paid = (order.payments ?? []).reduce((s, p) => s + p.amount_paise, 0);
  const remaining = Math.max(0, order.net_total_paise - paid);
  const isPaid = order.payment_status === "PAID" || remaining <= 0;
  return { paid, remaining, isPaid };
}

/**
 * Small payment pill, kept out of "Special instructions" so kitchen/packing/
 * riders can see at a glance whether money is still to be collected:
 * green PAID, red COD with the amount due, or grey "Pay at counter" for
 * unpaid dine-in/takeaway.
 */
export function PaymentModeBanner({ order, large = false, className = "" }: { order: SalesOrder; large?: boolean; className?: string }) {
  const { remaining, isPaid } = paymentSummary(order);
  const base = `inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wide whitespace-nowrap ${
    large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs"
  } ${className}`;
  const icon = large ? 14 : 12;

  if (isPaid) {
    return (
      <span className={`${base} bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300`}>
        <CheckCircle2 size={icon} /> Paid
      </span>
    );
  }

  if (order.order_type === "DELIVERY" || order.order_type === "ONLINE") {
    return (
      <span className={`${base} bg-rose-100 text-rose-800 ring-1 ring-rose-300`}>
        <Banknote size={icon} /> COD {formatPaise(remaining)}
      </span>
    );
  }

  return (
    <span className={`${base} bg-slate-100 text-slate-700 ring-1 ring-slate-300`}>
      <Store size={icon} /> Pay at counter
    </span>
  );
}
