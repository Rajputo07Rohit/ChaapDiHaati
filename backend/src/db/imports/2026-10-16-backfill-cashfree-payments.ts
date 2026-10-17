/**
 * One-off backfill: customer orders paid online through Cashfree before
 * 16 Oct 2026 were marked PAID but never got a payment line or a bank-ledger
 * credit, so they showed as "unpaid" in the day summary and the bank balance
 * was short by those amounts. New orders are booked correctly in code
 * (createCustomerOrder); this books the old ones the same way.
 *
 * Touched: orders with a Cashfree paymentRef, paymentStatus PAID, no ACTIVE
 * payment line, and not cancelled/refunded (those had their money returned).
 * Safe to re-run — an order that already has a payment line is skipped.
 *
 * Dry run by default (lists what it would do). To actually write:
 *   npx tsx src/db/imports/2026-10-16-backfill-cashfree-payments.ts --apply
 *
 * Note: bank entries are dated to each order's own business date. If any of
 * those days are already closed in Daily Closing, review those closings after.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { Order, OrderPaymentSub } from "../models";
import { recordBankTransaction } from "../../modules/bank/bank.service";
import { getCashfreePaymentMethodId } from "../../modules/paymentMethods/paymentMethods.service";
import { recordAudit } from "../../utils/audit";
import { newId, nowIso } from "../../utils/ids";
import { formatPaise } from "../../utils/money";

const APPLY = process.argv.includes("--apply");

async function main() {
  await connectMongo();
  const candidates = await Order.find({
    paymentRef: { $exists: true, $ne: null },
    paymentStatus: "PAID",
    status: { $nin: ["CANCELLED", "REFUNDED"] },
  }).sort({ createdAt: 1 });
  const missing = candidates.filter((o) => !o.payments.some((p) => p.status === "ACTIVE"));

  console.log(`${missing.length} Cashfree-paid order(s) missing from the books${APPLY ? "" : " (dry run — pass --apply to write)"}:`);
  for (const o of missing) console.log(`  #${o.orderNumber}  ${o.businessDate}  ${formatPaise(o.netTotalPaise)}  ${o.paymentRef}`);
  if (!APPLY || missing.length === 0) return;

  const methodId = await getCashfreePaymentMethodId();
  for (const o of missing) {
    await withTransaction(async (session) => {
      const doc = (await Order.findById(o._id).session(session))!;
      if (doc.payments.some((p) => p.status === "ACTIVE")) return;
      doc.payments.push({
        _id: newId("pay"),
        paymentMethodId: methodId,
        amountPaise: doc.netTotalPaise,
        reference: doc.paymentRef ?? null,
        status: "ACTIVE",
        createdBy: null,
        createdAt: nowIso(),
      } as OrderPaymentSub);
      await doc.save({ session });
      await recordBankTransaction(
        {
          businessDate: doc.businessDate,
          txnType: "CREDIT",
          amountPaise: doc.netTotalPaise,
          description: `Sale — order #${doc.orderNumber} (paid online via Cashfree, backfilled)`,
          reference: doc.paymentRef ?? null,
          category: "BUSINESS",
          paymentMethodId: methodId,
          userId: null,
        },
        session
      );
      await recordAudit(
        {
          userId: null,
          action: "CASHFREE_PAYMENT_BACKFILLED",
          entityType: "sales_order",
          entityId: doc._id,
          newValue: { amountPaise: doc.netTotalPaise, paymentRef: doc.paymentRef },
          reason: "Online payment was never booked to the order/bank ledger (pre-16 Oct 2026 bug).",
        },
        session
      );
    });
    console.log(`  booked #${o.orderNumber}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
