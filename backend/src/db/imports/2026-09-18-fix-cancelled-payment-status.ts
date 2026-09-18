/**
 * One-off correction: cancelOrder voided/refunded payments but never
 * updated order.paymentStatus, so a cancelled order could still show
 * "PAID" (fixed in code — see cancelOrder in orders.service.ts). Backfills
 * every existing CANCELLED order whose paymentStatus wasn't already
 * UNPAID, matching the corrected logic: REFUNDED if it had active
 * payments at cancel time (now voided), UNPAID otherwise.
 *
 * Display-only — does not touch any ledger, since the cash/bank reversal
 * already happened for real when each order was originally cancelled.
 *
 * Usage: npx tsx src/db/imports/2026-09-18-fix-cancelled-payment-status.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { Order } from "../models";

async function main() {
  await connectMongo();
  const orders = await Order.find({ status: "CANCELLED", paymentStatus: { $ne: "UNPAID" } });
  for (const order of orders) {
    const hadPayments = order.payments.some((p) => p.status === "VOIDED");
    const before = order.paymentStatus;
    order.paymentStatus = hadPayments ? "REFUNDED" : "UNPAID";
    await order.save();
    console.log(`Order #${order.orderNumber}: ${before} -> ${order.paymentStatus}`);
  }
  console.log(`\n✓ Corrected ${orders.length} order(s).`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
