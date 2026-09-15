/**
 * 13-Sept 2026 daily register data: sales, item mix, expenses, cash.
 *
 * Owner explicitly said "do not change the bank balance". Only Milk (₹32),
 * Paneer (₹200), and Miscellaneous (₹30) were tagged "cash" in the source
 * text — they sum to exactly ₹262, matching the register's own "Cash used =
 * 262" line, so those three are the only ones posted to the cash ledger.
 * Everything else in the "Expense details" list is recorded for accounting
 * completeness but posted to NEITHER ledger (cash or bank), since its real
 * payment source isn't confirmed and bank is off-limits per instruction.
 *
 * Two lines are real inventory items (Cream, Paneer) rather than operating
 * expenses — per the accounting rule (purchases increase inventory, they
 * are not automatically an expense) — so they're recorded as real
 * purchases, not lumped into the expenses table.
 *
 * Usage: npx tsx src/db/imports/2026-09-13-daily-data.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { recordAudit } = require("../../utils/audit") as typeof import("../../utils/audit");
const { recordPurchase } = require("../../modules/purchases/purchases.service") as typeof import("../../modules/purchases/purchases.service");
const { recordExpense } = require("../../modules/expenses/expenses.service") as typeof import("../../modules/expenses/expenses.service");
const { recordCashTransaction } = require("../../modules/cash/cash.service") as typeof import("../../modules/cash/cash.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const ADMIN_ROLE = "ADMIN" as const;
const rupees = (r: number) => Math.round(r * 100);
const DATE = "2026-09-13";

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;
const CASH = (db.prepare("SELECT id FROM payment_methods WHERE name = 'Cash'").get() as { id: string }).id;
const DESI_CHAAP = (db.prepare("SELECT id FROM suppliers WHERE name = 'Desi Chaap'").get() as { id: string }).id;

function itemId(name: string): string {
  return (db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(name) as { id: string }).id;
}

// ---- Cash-confirmed items only (the ones the register itself tagged "cash") ----
// Milk 32 + Paneer 200 + Miscellaneous 30 = 262, matching the register's own
// "Cash used = 262" line exactly — strong confirmation these three (and only
// these three) actually left the till today. Everything else in the
// "Expense details" list was NOT tagged cash, so its real payment source is
// unconfirmed; since the owner also said not to touch the bank balance, those
// lines are recorded for accounting completeness (so they show up in
// Purchases/Expenses/P&L) but are NOT posted to either the cash or bank
// ledger — inserted directly rather than through the normal service
// functions, which always post to one ledger or the other.

recordExpense({ businessDate: DATE, category: "Milk", description: "Milk", amountPaise: rupees(32), paymentMethodId: CASH }, ADMIN, ADMIN_ROLE);
recordExpense({ businessDate: DATE, category: "Miscellaneous", description: "Miscellaneous", amountPaise: rupees(30), paymentMethodId: CASH }, ADMIN, ADMIN_ROLE);
recordPurchase(
  {
    supplierId: DESI_CHAAP,
    businessDate: DATE,
    paymentMethodId: CASH,
    paymentStatus: "PAID",
    items: [{ inventoryItemId: itemId("Paneer"), quantity: 200 / 300, purchaseUnit: "kg", ratePaise: rupees(300) }],
    notes: "From owner's 13-Sept expense list, tagged 'cash' — really an inventory purchase (Paneer), not an operating expense. ₹200 at the confirmed ₹300/kg rate implies ~0.667kg (no quantity was given directly).",
  },
  ADMIN,
  ADMIN_ROLE
);

// ---- Cream: also a real inventory item, but NOT tagged cash — recorded
// unpaid (CREDIT) so it doesn't touch either ledger. ----
recordPurchase(
  {
    supplierId: DESI_CHAAP,
    businessDate: DATE,
    paymentStatus: "CREDIT",
    items: [{ inventoryItemId: itemId("Cream"), quantity: 12, purchaseUnit: "packet", ratePaise: Math.round(rupees(2840) / 12) }],
    notes: "From owner's 13-Sept expense list — really an inventory purchase (Cream: 12 pkt @ ₹236.67 = ₹2,840), not an operating expense. Not tagged 'cash' in the source, and the owner said not to touch the bank balance, so recorded unpaid (CREDIT) rather than guessing a payment method.",
  },
  ADMIN,
  ADMIN_ROLE
);

// ---- Remaining expense lines: not tagged cash, payment source unconfirmed.
// Inserted directly (bypassing recordExpense) so no cash/bank transaction is
// posted — these still show up in the expenses table and Expense Report.
interface ELine {
  category: string;
  description: string;
  amountRupees: number;
}
const UNFUNDED_EXPENSES: ELine[] = [
  { category: "Miscellaneous", description: "Rasan (groceries/ration)", amountRupees: 960 },
  { category: "Miscellaneous", description: "Puja samagri", amountRupees: 30 },
  { category: "Transport", description: "Petrol", amountRupees: 200 },
  { category: "Curd", description: "Dahi", amountRupees: 410 },
  { category: "Repair", description: "Fridge repair", amountRupees: 300 },
  { category: "Other", description: "Tea cup", amountRupees: 24 },
  { category: "Other", description: "Chap di hatti (unclear line — possibly a Desi Chaap supplier payment, no item breakdown given)", amountRupees: 740 },
];
for (const e of UNFUNDED_EXPENSES) {
  db.prepare(
    `INSERT INTO expenses (id, business_date, category, description, amount_paise, payment_method_id, notes, status, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'RECORDED', ?, ?, ?)`
  ).run(
    newId("exp"),
    DATE,
    e.category,
    e.description,
    rupees(e.amountRupees),
    CASH,
    "Not tagged 'cash' in the source register, and owner said not to touch the bank balance — recorded for accounting completeness but NOT posted to any ledger (cash or bank). Real payment source unconfirmed.",
    ADMIN,
    nowIso(),
    nowIso()
  );
}

// ---- Cash sales ----
recordCashTransaction({
  businessDate: DATE,
  txnType: "SALE",
  direction: "IN",
  amountPaise: rupees(1315),
  reason: "Reported cash sales — historical import (no itemised order data for this period)",
  userId: ADMIN,
});

// ---- Item-level sales ----
interface Line {
  category: "Chaap" | "Paneer Tikka" | "Momo" | "Roll" | "Bread";
  name: string;
  full?: number;
  half?: number;
  qty?: number;
}
const LINES: Line[] = [
  { category: "Chaap", name: "Malai", full: 2, half: 10 },
  { category: "Chaap", name: "Punjabi", full: 4, half: 9 },
  { category: "Chaap", name: "Chatpata", full: 2, half: 2 },
  { category: "Chaap", name: "Afgani", full: 3, half: 9 },
  { category: "Chaap", name: "Veg Tandoori Leg", half: 1 },
  { category: "Chaap", name: "Peri Peri", half: 1 },
  { category: "Chaap", name: "Veg Chicken Tikka", half: 1 },
  { category: "Paneer Tikka", name: "Afgani", qty: 1 },
  { category: "Momo", name: "Paneer Tandoori", half: 2 },
  { category: "Momo", name: "Veg Tandoori", half: 3 },
  { category: "Momo", name: "Veg Malai", half: 1 },
  { category: "Momo", name: "Veg Afgani", half: 1 },
  { category: "Roll", name: "Punjabi Chaap Roll", qty: 1 },
  { category: "Roll", name: "Chatpata Chaap Roll", qty: 2 },
  { category: "Roll", name: "Malai Chaap Roll", qty: 2 },
  { category: "Roll", name: "Black Pepper Chaap Roll", qty: 1 },
  { category: "Roll", name: "Peri Peri Chaap Roll", qty: 1 },
  { category: "Bread", name: "Rumali Roti", qty: 63 },
  { category: "Bread", name: "Butter Rumali Roti", qty: 11 },
];
const NOTE =
  "Chaap full-count sums to 11 vs register's reported f12 (diff 1); half-count sums to 33 vs reported hf42 (diff 9) — a larger gap than usual, entered as itemised, not corrected. Expense list: individual lines sum to ₹5,766 (after separating the Cream/Paneer purchases out) vs reported ₹5,156 (diff ₹610). Only Milk+Paneer+Misc (₹262 total) were tagged 'cash' and posted to the cash ledger, matching the register's own 'Cash used = 262' line exactly; the rest (₹5,504) is recorded but unposted to any ledger since its payment source isn't confirmed and bank is off-limits per owner instruction. Reported closing cash ₹5,276 stored as actual_cash_paise as given, even though it doesn't reconcile against yesterday's ₹3,880 + today's cash sales ₹1,315 − ₹262 = ₹4,933 — flagged, not corrected.";

const already = db.prepare("SELECT 1 FROM historical_item_sales WHERE business_date = ?").get(DATE);
if (already) {
  console.log("historical_item_sales already has rows for 13-Sept — skipping item-mix insert.");
} else {
  for (const l of LINES) {
    const full = l.full ?? 0;
    const half = l.half ?? 0;
    const qtyEquivalent = l.qty != null ? l.qty : full + half * 0.5;
    db.prepare(
      `INSERT INTO historical_item_sales (id, business_date, category, item_name, full_count, half_count, qty_equivalent, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(newId("hsale"), DATE, l.category, l.name, l.full ?? null, l.half ?? null, qtyEquivalent, NOTE, nowIso());
  }
}

// ---- Daily closing ----
function getCashSummary(date: string): number {
  const rows = db.prepare("SELECT direction, amount_paise FROM cash_transactions WHERE business_date <= ?").all(date) as {
    direction: "IN" | "OUT";
    amount_paise: number;
  }[];
  return rows.reduce((s, r) => s + (r.direction === "IN" ? r.amount_paise : -r.amount_paise), 0);
}

const grossPaise = rupees(10483);
const expensesRow = db.prepare("SELECT COALESCE(SUM(amount_paise),0) as t FROM expenses WHERE business_date = ? AND status = 'RECORDED'").get(DATE) as {
  t: number;
};
const expectedCash = getCashSummary(DATE);
const actualCash = rupees(5276);
const cashDiff = actualCash - expectedCash;
const notes = `Payment channels — Cash ₹1315, Paytm/UPI ₹9168, Zomato ₹0, Swiggy (not given). ${NOTE}`;

const existingClosing = db.prepare("SELECT 1 FROM daily_closings WHERE business_date = ?").get(DATE);
if (existingClosing) {
  console.log("daily_closings row already exists for 13-Sept — not overwriting.");
} else {
  db.prepare(
    `INSERT INTO daily_closings
      (id, business_date, status, opening_cash_paise, gross_sales_paise, discounts_paise, net_sales_paise,
       cogs_paise, gross_profit_paise, expenses_paise, net_profit_paise, expected_cash_paise, actual_cash_paise,
       cash_difference_paise, cash_diff_reason, bank_balance_paise, stock_value_paise,
       opened_by, closed_by, closed_at, notes, created_at, updated_at)
     VALUES (?, ?, 'CLOSED', 0, ?, 0, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("close"),
    DATE,
    grossPaise,
    grossPaise,
    expensesRow.t,
    expectedCash,
    actualCash,
    cashDiff,
    cashDiff !== 0 ? "Historical import — see notes for reconciliation detail." : null,
    ADMIN,
    ADMIN,
    nowIso(),
    notes,
    nowIso(),
    nowIso()
  );
}

recordAudit({
  userId: ADMIN,
  action: "HISTORICAL_DATA_IMPORTED",
  entityType: "daily_closing",
  newValue: { date: DATE, source: "owner register, 13 Sept 2026" },
  reason: "13-Sept daily register import — all cash-only per owner instruction not to touch the bank ledger",
});

console.log(`\n✓ 13-Sept data imported. Expected cash (ledger): ₹${(expectedCash / 100).toFixed(2)}, reported actual: ₹5,276.00, diff ₹${(cashDiff / 100).toFixed(2)}.`);
console.log("Bank ledger untouched, as instructed.");
