import { BusinessProfile, SalesOrder } from "../api/types";
import { formatPaise } from "./money";
import { orderTypeLabelFor, priceTypeLabelFor } from "./billFormat";

const DIVIDER = "━━━━━━━━━━━━━━━━━━";

/**
 * Accepts the common ways someone types an Indian mobile number — bare
 * 10-digit, with a "+91"/"91" country code, with a stray domestic trunk "0",
 * or with an "00" IDD prefix — and normalizes to the "91XXXXXXXXXX" form
 * WhatsApp's click-to-chat link requires. Returns null for anything that
 * isn't a plausible 10-digit Indian mobile number (which start 6-9), so
 * callers can show a validation error instead of generating a dead link.
 */
export function normalizeIndianPhone(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  if (digits.startsWith("0091")) digits = digits.slice(2); // 00 (IDD) + 91 -> 91

  if (digits.startsWith("91") && digits.length === 12) {
    digits = digits.slice(2);
  } else if (digits.startsWith("091") && digits.length === 13) {
    digits = digits.slice(3); // stray trunk 0 in front of the country code
  } else if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1); // domestic trunk prefix, no country code
  }

  if (digits.length !== 10 || !/^[6-9]\d{9}$/.test(digits)) return null;
  return `91${digits}`;
}

function formatBillDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = d.getDate().toString().padStart(2, "0");
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  let hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${dd}/${mm}/${d.getFullYear()}, ${hours}:${minutes} ${ampm}`;
}

/**
 * Renders the exact same order the printed receipt and on-screen bill show,
 * using only fields the backend already computed (line_subtotal_paise,
 * discount_paise, line_net_paise, item_discount_total_paise, discount_paise,
 * net_total_paise) — nothing here re-derives a total independently, so the
 * WhatsApp bill can never drift from what was actually charged.
 */
export function buildBillMessage(order: SalesOrder, profile: BusinessProfile, customerNameOverride?: string): string {
  const items = (order.items ?? []).filter((i) => i.status === "ACTIVE");

  const itemBlocks = items.map((i) => {
    const typeLabel = priceTypeLabelFor(i.price_type);
    const variant = typeLabel ? ` (${typeLabel})` : "";
    const lines = [
      `${i.item_name_snapshot}${variant} × ${i.quantity}`,
      `${formatPaise(i.unit_price_paise)} × ${i.quantity} = ${formatPaise(i.line_subtotal_paise)}`,
    ];
    if (i.discount_paise > 0) lines.push(`Discount: -${formatPaise(i.discount_paise)}`);
    lines.push(`Item Total: ${formatPaise(i.line_net_paise)}`);
    return lines.join("\n");
  });

  const addressLine = order && (profile.address || profile.tagline);

  const out: string[] = [];
  out.push(profile.businessName);
  if (profile.tagline) out.push(`${profile.tagline} 🌿`);
  out.push("");
  out.push(DIVIDER, "🧾 BILL RECEIPT", DIVIDER);
  out.push("");
  out.push(`Bill No.: #${order.order_number}`);
  out.push(`Date: ${formatBillDateTime(order.created_at)}`);
  out.push(`Customer: ${customerNameOverride?.trim() || order.customer_name || "Walk-in Customer"}`);
  out.push(`Order Type: ${orderTypeLabelFor(order.order_type)}`);
  out.push("");
  out.push(DIVIDER, "🍽️ ORDER DETAILS", DIVIDER);
  out.push("");
  out.push(itemBlocks.join("\n\n"));
  out.push("");
  out.push(DIVIDER, "💰 BILL SUMMARY", DIVIDER);
  out.push("");
  out.push(`Subtotal: ${formatPaise(order.subtotal_paise)}`);
  if (order.item_discount_total_paise > 0) out.push(`Item Discount: -${formatPaise(order.item_discount_total_paise)}`);
  if (order.discount_paise > 0) out.push(`Additional Discount: -${formatPaise(order.discount_paise)}`);
  out.push("");
  out.push(`GRAND TOTAL: ${formatPaise(order.net_total_paise)}`);
  out.push("");
  out.push(DIVIDER);
  out.push("");
  out.push(`🙏 Thank you for ordering from ${profile.businessName}!`);
  out.push("");
  out.push(`❤️ We hope you enjoyed your meal.`);
  out.push("");
  out.push(`📍 ${profile.businessName}`);
  if (addressLine) out.push(addressLine);

  return out.join("\n");
}

/** WhatsApp's official click-to-chat link — works from the WhatsApp mobile
 * app, WhatsApp Web, and the desktop app, whichever the OS/browser resolves
 * wa.me to. The message text is URL-encoded, never interpolated raw.
 *
 * The phone number is optional: with one, WhatsApp opens a chat with that
 * exact contact pre-filled; without one (dine-in customers who never gave a
 * number), WhatsApp still opens with the bill text ready to send — the
 * person sharing just picks who to send it to themselves. */
export function buildWhatsAppShareUrl(normalizedPhone: string | null, message: string): string {
  const text = encodeURIComponent(message);
  return normalizedPhone ? `https://wa.me/${normalizedPhone}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
}
