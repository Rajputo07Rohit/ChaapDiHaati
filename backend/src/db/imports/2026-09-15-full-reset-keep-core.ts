/**
 * Owner-requested full data reset, confirmed scope after several rounds of
 * clarification:
 *
 * KEEP: Menu (categories/items/prices), Recipes, Staff, Expenses, User
 * logins, PaymentMethod, Supplier, Setting (except bank balance keys, see
 * below), AuditLog (append-only compliance trail — not "data" in the
 * working sense, left alone rather than assumed).
 *
 * DELETE: Orders (+ their embedded items/payments/discounts), Purchases,
 * Inventory (items/movements/wastage), Stock Counts, Cash & Bank ledger
 * (transactions AND the bank opening-balance/statement settings, so the
 * ledger truly starts at ₹0 rather than inheriting an old balance), Daily
 * Closings, and the historical register data imported earlier.
 *
 * A full JSON backup of every collection is written first — this is a real
 * production database with no simple single-file restore, so this is the
 * only safety net if something needs to be recovered.
 *
 * Usage: npx tsx src/db/imports/2026-09-15-full-reset-keep-core.ts
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import {
  Order,
  Purchase,
  InventoryItem,
  InventoryMovement,
  WastageRecord,
  StockCount,
  CashTransaction,
  BankTransaction,
  DailyClosing,
  HistoricalItemSale,
  Setting,
} from "../models";

const TO_DELETE = [
  { name: "Order", model: Order },
  { name: "Purchase", model: Purchase },
  { name: "InventoryItem", model: InventoryItem },
  { name: "InventoryMovement", model: InventoryMovement },
  { name: "WastageRecord", model: WastageRecord },
  { name: "StockCount", model: StockCount },
  { name: "CashTransaction", model: CashTransaction },
  { name: "BankTransaction", model: BankTransaction },
  { name: "DailyClosing", model: DailyClosing },
  { name: "HistoricalItemSale", model: HistoricalItemSale },
];

async function main() {
  await connectMongo();

  const backupDir = path.join(__dirname, "../../../../backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupDir, `mongo_full_backup_before_reset_${stamp}.json`);

  const backup: Record<string, unknown[]> = {};
  for (const { name, model } of TO_DELETE) {
    backup[name] = await model.find({}).lean();
  }
  // Also back up the bank-related settings before clearing them.
  backup["Setting(bank keys)"] = await Setting.find({ key: { $regex: /^bank_/ } }).lean();

  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
  console.log(`Backup written: ${backupFile}`);

  for (const { name, model } of TO_DELETE) {
    const res = await model.deleteMany({});
    console.log(`Deleted ${res.deletedCount} from ${name}`);
  }

  const settingsRes = await Setting.deleteMany({ key: { $regex: /^bank_/ } });
  console.log(`Deleted ${settingsRes.deletedCount} bank-balance setting(s) — ledger now starts fresh at ₹0`);

  console.log("\n✓ Reset complete. Kept: Menu, Recipes, Staff, Expenses, User logins, Payment Methods, Suppliers, Audit Log.");
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
