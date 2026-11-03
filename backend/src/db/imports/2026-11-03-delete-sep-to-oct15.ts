/**
 * Owner asked to delete all data from 1 Sept through 15 Oct 2026 (business
 * dates). Scope: orders (+ their refunds and feedback), cash and bank ledger
 * entries, inventory movements, purchases, daily closings and stock counts
 * in that range. Data from 16 Oct onward is untouched; audit logs are kept
 * (append-only by design).
 *
 * Today's numbers must not move: cash balance, bank balance and every
 * item's stock are running sums of the ledgers, so the net of what's deleted
 * is carried forward —
 *   - cash: one OPENING entry dated 2026-10-16
 *   - bank: added to the bank opening-balance setting
 *   - stock: one OPENING_STOCK / STOCK_ADJUSTMENT movement per item, dated 2026-10-16
 * The whole thing runs in one transaction and is verified (balances and
 * per-item stock before == after) before commit; any mismatch rolls back.
 *
 * Default is a DRY RUN: prints counts and writes a JSON backup of everything
 * that would be deleted to ../backups/. Nothing is deleted without --execute.
 *
 * Usage:
 *   npx tsx src/db/imports/2026-11-03-delete-sep-to-oct15.ts            # dry run + backup
 *   npx tsx src/db/imports/2026-11-03-delete-sep-to-oct15.ts --execute  # really delete
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { connectMongo, withTransaction } from "../mongoose";
import {
  BankTransaction,
  CashTransaction,
  DailyClosing,
  InventoryItem,
  InventoryMovement,
  Order,
  OrderFeedback,
  Purchase,
  Refund,
  Setting,
  StockCount,
  User,
} from "../models";
import { recordAudit } from "../../utils/audit";
import { newId, nowIso } from "../../utils/ids";

const FROM = "2026-09-01";
const TO = "2026-10-15"; // businessDate is a YYYY-MM-DD string, so lexical range is correct
const CARRY_DATE = "2026-10-16";
const REASON = `Carried forward: net of ${FROM}..${TO} records deleted on owner's request (2026-11-03)`;
const BANK_OPENING_KEY = "bank_opening_balance_paise";

const inRange = { businessDate: { $gte: FROM, $lte: TO } };
const signed = (direction: "IN" | "OUT", amount: number) => (direction === "IN" ? amount : -amount);

/** Everything today's numbers are built from, so before/after can be compared exactly. */
async function snapshot(session?: mongoose.ClientSession) {
  const cash = await CashTransaction.find().session(session ?? null).lean();
  const bank = await BankTransaction.find().session(session ?? null).lean();
  const bankOpening = await Setting.findById(BANK_OPENING_KEY).session(session ?? null).lean();
  const movements = await InventoryMovement.find().session(session ?? null).lean();
  const stock = new Map<string, number>();
  for (const m of movements) stock.set(m.inventoryItemId, (stock.get(m.inventoryItemId) ?? 0) + signed(m.direction, m.quantityBase));
  return {
    cashPaise: cash.reduce((s, t) => s + signed(t.direction, t.amountPaise), 0),
    bankPaise:
      (bankOpening ? parseInt(String(bankOpening.value), 10) : 0) +
      bank.reduce((s, t) => s + (t.txnType === "CREDIT" ? t.amountPaise : -t.amountPaise), 0),
    stock,
  };
}

async function main() {
  const execute = process.argv.includes("--execute");
  await connectMongo();

  const orders = await Order.find(inRange).lean();
  const orderIds = orders.map((o) => o._id);
  const refunds = await Refund.find({ salesOrderId: { $in: orderIds } }).lean();
  const feedback = await OrderFeedback.find({ _id: { $in: orderIds } }).lean();
  const cash = await CashTransaction.find(inRange).lean();
  const bank = await BankTransaction.find(inRange).lean();
  const movements = await InventoryMovement.find(inRange).lean();
  const purchases = await Purchase.find(inRange).lean();
  const closings = await DailyClosing.find(inRange).lean();
  const stockCounts = await StockCount.find(inRange).lean();
  const bankOpening = await Setting.findById(BANK_OPENING_KEY).lean();

  const cashNet = cash.reduce((s, t) => s + signed(t.direction, t.amountPaise), 0);
  const bankNet = bank.reduce((s, t) => s + (t.txnType === "CREDIT" ? t.amountPaise : -t.amountPaise), 0);
  const stockNet = new Map<string, number>();
  for (const m of movements) stockNet.set(m.inventoryItemId, (stockNet.get(m.inventoryItemId) ?? 0) + signed(m.direction, m.quantityBase));

  console.log(`Range ${FROM}..${TO} (carry-forward date ${CARRY_DATE})`);
  console.log(`  orders ${orders.length}, refunds ${refunds.length}, feedback ${feedback.length}`);
  console.log(`  cash entries ${cash.length} (net ${cashNet / 100} ₹), bank entries ${bank.length} (net ${bankNet / 100} ₹)`);
  console.log(`  stock movements ${movements.length} across ${stockNet.size} items`);
  console.log(`  purchases ${purchases.length}, daily closings ${closings.length}, stock counts ${stockCounts.length}`);

  if (orders.length + cash.length + bank.length + movements.length + purchases.length + closings.length + stockCounts.length === 0) {
    console.log("Nothing to delete.");
    await mongoose.disconnect();
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const backupPath = path.resolve(__dirname, "../../../../backups", `sep_to_oct15_${stamp}.json`);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.writeFileSync(
    backupPath,
    JSON.stringify({ range: { FROM, TO }, orders, refunds, feedback, cash, bank, movements, purchases, closings, stockCounts, bankOpening }, null, 1)
  );
  console.log(`Backup written: ${backupPath}`);

  if (!execute) {
    console.log("\nDRY RUN — nothing deleted. Re-run with --execute to delete.");
    await mongoose.disconnect();
    return;
  }

  const admin = await User.findOne({ role: "ADMIN" }).sort({ createdAt: 1 }).lean();
  const before = await snapshot();
  const now = nowIso();

  await withTransaction(async (session) => {
    await Refund.deleteMany({ salesOrderId: { $in: orderIds } }, { session });
    await OrderFeedback.deleteMany({ _id: { $in: orderIds } }, { session });
    await Order.deleteMany({ _id: { $in: orderIds } }, { session });
    await CashTransaction.deleteMany(inRange, { session });
    await BankTransaction.deleteMany(inRange, { session });
    await InventoryMovement.deleteMany(inRange, { session });
    await Purchase.deleteMany(inRange, { session });
    await DailyClosing.deleteMany(inRange, { session });
    await StockCount.deleteMany(inRange, { session });

    if (cashNet !== 0) {
      await CashTransaction.create(
        [
          {
            _id: newId("cash"),
            businessDate: CARRY_DATE,
            txnType: "OPENING",
            direction: cashNet > 0 ? "IN" : "OUT",
            amountPaise: Math.abs(cashNet),
            referenceType: "CARRY_FORWARD",
            referenceId: null,
            reason: REASON,
            createdBy: admin?._id ?? null,
            createdAt: now,
          },
        ],
        { session }
      );
    }

    if (bankNet !== 0) {
      const opening = bankOpening ? parseInt(String(bankOpening.value), 10) : 0;
      await Setting.findByIdAndUpdate(
        BANK_OPENING_KEY,
        { value: String(opening + bankNet), updatedBy: admin?._id ?? null, updatedAt: now },
        { upsert: true, session }
      );
    }

    for (const [inventoryItemId, net] of stockNet) {
      if (Math.abs(net) < 1e-9) continue;
      const item = await InventoryItem.findById(inventoryItemId).session(session).lean();
      const unitCost = item?.avgCostPaisePerBase ?? null;
      await InventoryMovement.create(
        [
          {
            _id: newId("mov"),
            inventoryItemId,
            movementType: net > 0 ? "OPENING_STOCK" : "STOCK_ADJUSTMENT",
            direction: net > 0 ? "IN" : "OUT",
            quantityBase: Math.abs(net),
            unitCostPaisePerBase: unitCost,
            totalCostPaise: unitCost != null ? Math.round(unitCost * Math.abs(net)) : null,
            referenceType: "CARRY_FORWARD",
            referenceId: null,
            reason: REASON,
            businessDate: CARRY_DATE,
            createdBy: admin?._id ?? null,
            createdAt: now,
          },
        ],
        { session }
      );
    }

    const after = await snapshot(session);
    if (after.cashPaise !== before.cashPaise) throw new Error(`Cash balance changed: ${before.cashPaise} -> ${after.cashPaise}`);
    if (after.bankPaise !== before.bankPaise) throw new Error(`Bank balance changed: ${before.bankPaise} -> ${after.bankPaise}`);
    for (const [id, qty] of before.stock) {
      if (Math.abs((after.stock.get(id) ?? 0) - qty) > 1e-6) throw new Error(`Stock changed for item ${id}: ${qty} -> ${after.stock.get(id)}`);
    }

    await recordAudit(
      {
        userId: admin?._id ?? null,
        action: "DATA_PURGED",
        entityType: "database",
        entityId: `${FROM}..${TO}`,
        oldValue: {
          orders: orders.length,
          cash: cash.length,
          bank: bank.length,
          movements: movements.length,
          purchases: purchases.length,
          closings: closings.length,
          stockCounts: stockCounts.length,
        },
        newValue: { cashNetCarried: cashNet, bankNetCarried: bankNet, stockItemsCarried: stockNet.size, backup: path.basename(backupPath) },
        reason: "Owner asked to delete 1 Sept – 15 Oct 2026 data",
      },
      session
    );
  });

  console.log(`\n✓ Deleted. Cash ₹${before.cashPaise / 100}, bank ₹${before.bankPaise / 100} and every item's stock are unchanged.`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await mongoose.disconnect();
  process.exit(1);
});
