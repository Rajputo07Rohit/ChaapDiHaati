/**
 * One-time cleanup: kitchenStatus was just added to the Order schema and
 * defaults to "PENDING", so every order that already existed before the
 * Kitchen feature shipped — including ones from days/weeks ago that are
 * long since COMPLETED/DELIVERED/CANCELLED — showed up in the Kitchen
 * queue as if newly placed. Marks every currently-PENDING order READY in
 * one pass, so the Kitchen screen starts clean from this moment forward:
 * only orders actually created after this runs will need a real "Mark
 * Ready" tap.
 *
 * Usage: npx tsx src/db/imports/2026-09-22-clear-kitchen-backlog.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { Order } from "../models";

async function main() {
  await connectMongo();
  // kitchenStatus is a brand-new schema field with a default — existing
  // documents never actually got it written to storage, so a raw query for
  // {kitchenStatus: "PENDING"} matches nothing; Mongoose only fills the
  // default in when hydrating a document for reads, not for this kind of
  // direct update query. Match on missing-or-pending explicitly.
  const res = await Order.updateMany(
    { $or: [{ kitchenStatus: { $exists: false } }, { kitchenStatus: "PENDING" }] },
    { $set: { kitchenStatus: "READY" } }
  );
  console.log(`Cleared ${res.modifiedCount} order(s) from the kitchen backlog.`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
