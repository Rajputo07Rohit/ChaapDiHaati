/**
 * One-off fix: 9 real delivery orders (already assigned to a rider, several
 * already paid) were stuck at CONFIRMED/PREPARING because nothing had ever
 * advanced them through the old kitchen-staging chain to OUT_FOR_DELIVERY —
 * the actual root cause of "rider doesn't see it / nothing reflects".
 * createOrder no longer creates this problem going forward (a delivery
 * order with a rider now starts at OUT_FOR_DELIVERY directly); this just
 * unsticks the orders that were created before that fix.
 *
 * Usage: npx tsx src/db/imports/2026-09-15-unstick-delivery-orders.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { Order, User } from "../models";
import { recordAudit } from "../../utils/audit";
import { nowIso } from "../../utils/ids";

async function main() {
  await connectMongo();
  const admin = await User.findOne({ username: "admin" });
  if (!admin) throw new Error("No admin user found.");

  const stuck = await Order.find({
    orderType: "DELIVERY",
    assignedRiderId: { $ne: null },
    status: { $in: ["CONFIRMED", "PREPARING", "READY"] },
  });

  console.log(`Found ${stuck.length} stuck delivery order(s).`);

  for (const order of stuck) {
    const oldStatus = order.status;
    order.status = "OUT_FOR_DELIVERY";
    order.updatedAt = nowIso();
    await order.save();

    await recordAudit({
      userId: admin._id,
      action: "ORDER_STATUS_UPDATED",
      entityType: "sales_order",
      entityId: order._id,
      oldValue: { status: oldStatus },
      newValue: { status: "OUT_FOR_DELIVERY" },
      reason: "One-off fix: unstuck from the old kitchen-staging chain so it reaches the assigned rider",
    });

    console.log(`Order #${order.orderNumber}: ${oldStatus} -> OUT_FOR_DELIVERY`);
  }

  console.log("\n✓ Done.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
