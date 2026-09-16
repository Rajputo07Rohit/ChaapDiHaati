/**
 * 1) Corrects Butter's price: it was priced at ₹220/kg (22 paise/g) from the
 *    16-Sept price list, but the owner clarified ₹220 is actually for
 *    half a kg (500g) — so the real cost is 44 paise/g, double what was
 *    recorded. Chicken Masala's ₹85/100g (85 paise/g) was already correct,
 *    no change needed there.
 *
 * 2) Corrects two stock quantities that had a stray +100,000g manual
 *    adjustment applied through the Inventory screen on 16 Sept (visible in
 *    each item's movement history as a "Stock added" STOCK_ADJUSTMENT):
 *      - Butter: was 100,000g, corrected down to 1,000g (1kg).
 *      - Chicken Masala: was 100,370g, corrected down to 100g.
 *
 * 3) Deletes every order (owner-requested reset) and rewinds the
 *    order_number counter so the next order created starts again at 1001
 *    (nextSequence's built-in start value for "order_number").
 *
 * Usage: npx tsx src/db/imports/2026-09-16-fix-prices-reset-orders.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { InventoryItem, Order, Counter, User } from "../models";
import { setInventoryItemCost, recordMovement } from "../../modules/inventory/inventory.service";

async function main() {
  await connectMongo();
  const admin = await User.findOne({ username: "admin" });
  if (!admin) throw new Error("No admin user found.");
  const ADMIN = admin._id;
  const REASON = "Owner correction, 16 Sept 2026";
  const BUSINESS_DATE = "2026-09-16";

  // 1) Butter price correction.
  const butter = await InventoryItem.findOne({ name: "Butter" });
  if (!butter) throw new Error("Butter not found.");
  await setInventoryItemCost(butter._id, 44, REASON, ADMIN);
  console.log(`Butter price: ${butter.avgCostPaisePerBase} -> 44 paise/g`);

  // 2) Stock quantity corrections.
  await withTransaction(async (session) => {
    const b = await InventoryItem.findById(butter._id).session(session);
    const deltaB = 1000 - b!.currentQtyBase;
    if (deltaB !== 0) {
      await recordMovement(
        {
          inventoryItemId: b!._id,
          movementType: "STOCK_ADJUSTMENT",
          direction: deltaB > 0 ? "IN" : "OUT",
          quantityBase: Math.abs(deltaB),
          unitCostPaisePerBase: null,
          referenceType: "STOCK_COUNT",
          reason: `${REASON} — correcting a stray +100,000g manual adjustment (was ${b!.currentQtyBase}g, corrected to 1000g)`,
          businessDate: BUSINESS_DATE,
          userId: ADMIN,
          allowNegativeStock: true,
        },
        session
      );
      console.log(`Butter qty: ${b!.currentQtyBase}g -> 1000g`);
    }

    const chicken = await InventoryItem.findOne({ name: "Chicken Masala" }).session(session);
    if (!chicken) throw new Error("Chicken Masala not found.");
    const deltaC = 100 - chicken.currentQtyBase;
    if (deltaC !== 0) {
      await recordMovement(
        {
          inventoryItemId: chicken._id,
          movementType: "STOCK_ADJUSTMENT",
          direction: deltaC > 0 ? "IN" : "OUT",
          quantityBase: Math.abs(deltaC),
          unitCostPaisePerBase: null,
          referenceType: "STOCK_COUNT",
          reason: `${REASON} — correcting a stray +100,000g manual adjustment (was ${chicken.currentQtyBase}g, corrected to 100g)`,
          businessDate: BUSINESS_DATE,
          userId: ADMIN,
          allowNegativeStock: true,
        },
        session
      );
      console.log(`Chicken Masala qty: ${chicken.currentQtyBase}g -> 100g`);
    }
  });

  // 3) Delete all orders, rewind order_number back to start at 1001.
  const deleted = await Order.deleteMany({});
  console.log(`Deleted ${deleted.deletedCount} order(s).`);
  await Counter.updateOne({ _id: "order_number" }, { $set: { nextValue: 1000 } }, { upsert: true });
  console.log("order_number counter reset — next order will be #1001.");

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
