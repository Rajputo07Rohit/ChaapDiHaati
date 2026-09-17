/**
 * Reusable correction: retags one or more COMPLETED orders' Cash payment to
 * UPI, and moves the money between ledgers to match — reverses the cash-in
 * entry and posts an equivalent bank credit, so Cash-in-Hand and Bank
 * Balance both end up correct, not just the order's own label.
 *
 * Only COMPLETED orders are touched, and only if their current active
 * payment is still tagged Cash (safe to re-run / pass an already-fixed
 * order number, it just gets skipped).
 *
 * Usage: npx tsx src/db/imports/fix-payment-method-to-upi.ts 1064 1065
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { Order, PaymentMethod, User } from "../models";
import { recordCashTransaction } from "../../modules/cash/cash.service";
import { recordBankTransaction } from "../../modules/bank/bank.service";
import { recordAudit } from "../../utils/audit";

const orderNumbers = process.argv.slice(2).map((n) => parseInt(n, 10));

async function main() {
  if (orderNumbers.length === 0 || orderNumbers.some(Number.isNaN)) {
    console.error("Usage: npx tsx src/db/imports/fix-payment-method-to-upi.ts <orderNumber> [orderNumber...]");
    process.exit(1);
  }

  await connectMongo();
  const admin = await User.findOne({ username: "admin" });
  if (!admin) throw new Error("No admin user found.");
  const ADMIN = admin._id;

  const upi = await PaymentMethod.findOne({ name: "UPI" });
  if (!upi) throw new Error("UPI payment method not found.");
  const cash = await PaymentMethod.findOne({ type: "CASH" });
  if (!cash) throw new Error("Cash payment method not found.");

  for (const orderNumber of orderNumbers) {
    const order = await Order.findOne({ orderNumber });
    if (!order) {
      console.log(`Order #${orderNumber}: not found — skipped.`);
      continue;
    }
    if (order.status !== "COMPLETED") {
      console.log(`Order #${orderNumber}: status is ${order.status}, not COMPLETED — skipped.`);
      continue;
    }
    const cashPayments = order.payments.filter((p) => p.status === "ACTIVE" && p.paymentMethodId === cash._id);
    if (cashPayments.length === 0) {
      console.log(`Order #${orderNumber}: no active Cash payment found — already fixed or never Cash. Skipped.`);
      continue;
    }

    await withTransaction(async (session) => {
      const doc = (await Order.findById(order._id).session(session))!;
      for (const p of doc.payments) {
        if (p.status !== "ACTIVE" || p.paymentMethodId !== cash._id) continue;

        await recordCashTransaction(
          {
            businessDate: doc.businessDate,
            txnType: "REFUND",
            direction: "OUT",
            amountPaise: p.amountPaise,
            referenceType: "ORDER",
            referenceId: doc._id,
            reason: `Correction: order #${doc.orderNumber} was actually paid UPI, not Cash — reversing the cash-in entry`,
            userId: ADMIN,
          },
          session
        );
        await recordBankTransaction(
          {
            businessDate: doc.businessDate,
            txnType: "CREDIT",
            amountPaise: p.amountPaise,
            description: `Sale correction — order #${doc.orderNumber} (UPI)`,
            category: "BUSINESS",
            paymentMethodId: upi._id,
            userId: ADMIN,
          },
          session
        );
        p.paymentMethodId = upi._id;
      }
      await doc.save({ session });

      await recordAudit(
        {
          userId: ADMIN,
          action: "ORDER_PAYMENT_METHOD_CORRECTED",
          entityType: "sales_order",
          entityId: doc._id,
          oldValue: { paymentMethodId: cash._id, paymentMethodName: "Cash" },
          newValue: { paymentMethodId: upi._id, paymentMethodName: "UPI" },
          reason: "Owner confirmed this order was actually paid via UPI",
        },
        session
      );
    });

    console.log(`Order #${orderNumber}: Cash -> UPI, ledgers corrected.`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
