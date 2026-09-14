/**
 * Owner asked to remove all 4 orders currently in the system (#1001-#1004,
 * dated 13-14 Sept) — leftover test orders from earlier feature verification,
 * not real sales. There is no hard-delete for a completed order (by design,
 * for audit integrity), so each is fully refunded via the real refund flow
 * instead — reverses inventory, cash/bank ledger, and sales figures, while
 * keeping the record itself visible as REFUNDED for traceability.
 * #1002 is already REFUNDED — left untouched.
 *
 * Usage: npx tsx src/db/imports/2026-09-14-clear-old-test-orders.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { refundOrder } = require("../../modules/orders/orders.service") as typeof import("../../modules/orders/orders.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;
const CASH = (db.prepare("SELECT id FROM payment_methods WHERE name = 'Cash'").get() as { id: string }).id;
const UPI = (db.prepare("SELECT id FROM payment_methods WHERE name = 'UPI'").get() as { id: string }).id;

const TO_REFUND: { orderNumber: number; amountPaise: number; paymentMethodId: string }[] = [
  { orderNumber: 1001, amountPaise: 15000, paymentMethodId: CASH },
  { orderNumber: 1003, amountPaise: 19000, paymentMethodId: UPI },
  { orderNumber: 1004, amountPaise: 31000, paymentMethodId: CASH },
];

for (const r of TO_REFUND) {
  const order = db.prepare("SELECT id, status FROM sales_orders WHERE order_number = ?").get(r.orderNumber) as
    | { id: string; status: string }
    | undefined;
  if (!order) {
    console.log(`Order #${r.orderNumber} not found — skipping.`);
    continue;
  }
  if (order.status !== "COMPLETED") {
    console.log(`Order #${r.orderNumber} is ${order.status}, not COMPLETED — skipping.`);
    continue;
  }
  refundOrder(
    order.id,
    { amountPaise: r.amountPaise, reason: "Removed per owner request — old test data cleanup", refundType: "FULL", paymentMethodId: r.paymentMethodId },
    ADMIN,
    "ADMIN"
  );
  console.log(`Refunded order #${r.orderNumber}.`);
}

console.log("\n✓ Done. #1002 was already REFUNDED and left as-is.");
