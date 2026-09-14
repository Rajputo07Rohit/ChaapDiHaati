import { SalesOrder } from "../api/types";
import { formatPaise } from "./money";
import { priceTypeLabelFor } from "./billFormat";
import logoBase64 from "../assets/logo-receipt-base64.txt?raw";

const LOGO_DATA_URI = `data:image/png;base64,${logoBase64}`;

/**
 * Prints through a hidden iframe on the current page instead of a new tab —
 * staff never leave the POS/Orders screen mid-order to print a bill, and
 * there's no pop-up to get blocked in the first place. One iframe is reused
 * across prints rather than growing a new hidden element every time.
 */
function printViaHiddenIframe(html: string) {
  let iframe = document.getElementById("receipt-print-frame") as HTMLIFrameElement | null;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "receipt-print-frame";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
  }
  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  // Give the iframe a tick to lay out before invoking print.
  setTimeout(() => {
    iframe!.contentWindow?.focus();
    iframe!.contentWindow?.print();
  }, 200);
}

/**
 * Renders the bill and triggers the browser's print dialog — the same flow
 * a thermal receipt printer setup on a POS PC uses (the printer is just the
 * default/selected printer in that dialog).
 */
export function printReceipt(order: SalesOrder, restaurantName = "Chaap Di Haati") {
  const items = order.items ?? [];
  const payments = order.payments ?? [];

  const itemRows = items
    .filter((i) => i.status === "ACTIVE")
    .map((i) => {
      const typeLabel = priceTypeLabelFor(i.price_type);
      const label = typeLabel ? ` (${typeLabel})` : "";
      return `
        <tr>
          <td>${escapeHtml(i.item_name_snapshot)}${label}</td>
          <td class="num">${i.quantity}</td>
          <td class="num">${formatPaise(i.unit_price_paise)}</td>
          <td class="num">${formatPaise(i.line_net_paise)}</td>
        </tr>
        ${
          i.discount_paise > 0
            ? `<tr class="disc"><td colspan="3">Item discount</td><td class="num">-${formatPaise(i.discount_paise)}</td></tr>`
            : ""
        }`;
    })
    .join("");

  const paymentRows = payments
    .map((p) => `<tr><td>${escapeHtml(p.payment_method_name)}</td><td class="num">${formatPaise(p.amount_paise)}</td></tr>`)
    .join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Bill #${order.order_number}</title>
<style>
  @page { margin: 8mm; }
  * { box-sizing: border-box; }
  body { font-family: "Courier New", monospace; width: 300px; margin: 0 auto; color: #000; font-size: 12px; }
  .logo { display: block; width: 64px; height: 64px; object-fit: contain; margin: 0 auto 4px; }
  h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
  .sub { text-align: center; font-size: 11px; margin-bottom: 8px; }
  .meta { display: flex; justify-content: space-between; font-size: 11px; margin-bottom: 4px; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; border-bottom: 1px solid #000; padding-bottom: 2px; }
  td { padding: 2px 0; vertical-align: top; }
  .num { text-align: right; white-space: nowrap; }
  .disc td { font-size: 10px; color: #444; }
  .totals td { padding-top: 2px; }
  .grand { font-weight: bold; font-size: 14px; }
  .center { text-align: center; }
  .foot { text-align: center; font-size: 11px; margin-top: 10px; }
  @media print { body { width: auto; } }
</style>
</head>
<body>
  <img class="logo" src="${LOGO_DATA_URI}" alt="">
  <h1>${escapeHtml(restaurantName)}</h1>
  <div class="sub">Order Receipt</div>
  <div class="meta"><span>Bill #${order.order_number}</span><span>${order.business_date}</span></div>
  <div class="meta"><span>${order.order_type.replace("_", "-")}</span><span>${new Date(order.created_at).toLocaleTimeString()}</span></div>
  <hr>
  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amt</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <hr>
  <table>
    <tbody class="totals">
      <tr><td>Subtotal</td><td></td><td></td><td class="num">${formatPaise(order.subtotal_paise)}</td></tr>
      ${
        order.item_discount_total_paise > 0
          ? `<tr><td>Item discounts</td><td></td><td></td><td class="num">-${formatPaise(order.item_discount_total_paise)}</td></tr>`
          : ""
      }
      ${
        order.discount_paise > 0
          ? `<tr><td>Discount${order.discount_type === "PERCENTAGE" ? ` (${order.discount_value}%)` : ""}</td><td></td><td></td><td class="num">-${formatPaise(order.discount_paise)}</td></tr>`
          : ""
      }
      <tr class="grand"><td>Total</td><td></td><td></td><td class="num">${formatPaise(order.net_total_paise)}</td></tr>
    </tbody>
  </table>
  ${
    paymentRows
      ? `<hr><table><thead><tr><th>Paid via</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>`
      : ""
  }
  <hr>
  <div class="foot">Thank you — visit again!</div>
</body>
</html>`;

  printViaHiddenIframe(html);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
