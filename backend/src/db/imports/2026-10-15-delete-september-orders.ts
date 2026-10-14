/**
 * Owner asked to delete the previous month's (September 2026) order data.
 * Scope: orders only — the Order documents (which embed items, payments and
 * discounts) plus their Refund records. Cash/bank ledger, expenses,
 * purchases, inventory and daily closings are deliberately left alone.
 *
 * Default is a DRY RUN: prints counts and writes a JSON backup of everything
 * that would be deleted to ../backups/. Nothing is deleted without --execute.
 *
 * Usage:
 *   npx tsx src/db/imports/2026-10-15-delete-september-orders.ts            # dry run + backup
 *   npx tsx src/db/imports/2026-10-15-delete-september-orders.ts --execute  # really delete
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { Order, Refund } from "../models";

const FROM = "2026-09-01";
const TO = "2026-09-30"; // businessDate is a YYYY-MM-DD string, so lexical range is correct

async function main() {
  const execute = process.argv.includes("--execute");
  await connectMongo();

  const orders = await Order.find({ businessDate: { $gte: FROM, $lte: TO } }).lean();
  const orderIds = orders.map((o) => o._id);
  const refunds = await Refund.find({ salesOrderId: { $in: orderIds } }).lean();

  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const dates = orders.map((o) => o.businessDate).sort();
  console.log(`Orders with business date ${FROM}..${TO}: ${orders.length}`);
  console.log(`  date range found: ${dates[0] ?? "-"} .. ${dates[dates.length - 1] ?? "-"}`);
  console.log(`  by status:`, byStatus);
  console.log(`  refund records: ${refunds.length}`);

  if (orders.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = path.resolve(__dirname, "../../../../backups", `september_orders_${stamp}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(backupPath, JSON.stringify({ orders, refunds }, null, 2));
  console.log(`Backup written: ${backupPath}`);

  if (!execute) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --execute to delete.");
    return;
  }

  const delRefunds = await Refund.deleteMany({ salesOrderId: { $in: orderIds } });
  const delOrders = await Order.deleteMany({ _id: { $in: orderIds } });
  console.log(`\nDeleted ${delOrders.deletedCount} orders and ${delRefunds.deletedCount} refund records.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
