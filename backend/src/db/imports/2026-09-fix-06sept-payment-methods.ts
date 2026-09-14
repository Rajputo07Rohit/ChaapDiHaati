/**
 * Correction pass: three 06-Sept expense lines (Miscellaneous + chain ₹4,191,
 * Food ₹1,580, Simla/grocery ₹1,400) were imported tagged as CASH by
 * mistake — the source notes never marked them "cash" (unlike Milk and Dahi
 * that day, which repeat the explicit "cash" tag seen on every other day).
 * Leaving them as cash drove the calculated cash ledger deeply negative
 * from 06-Sept onward, which cannot be right — a till cannot go negative.
 *
 * This re-tags those three expenses as UPI (bank), removes their wrongly-
 * posted cash_transaction, posts the equivalent bank_transaction instead,
 * and recomputes expected_cash_paise / bank_balance_paise / cash_difference
 * on every daily_closings row from 06 to 12 Sept (the ones whose cumulative
 * ledger changes as a result).
 *
 * Usage: npx tsx src/db/imports/2026-09-fix-06sept-payment-methods.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { getBankBalancePaise } = require("../../modules/bank/bank.service") as typeof import("../../modules/bank/bank.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;
const UPI = (db.prepare("SELECT id FROM payment_methods WHERE name = 'UPI'").get() as { id: string }).id;

const TARGETS = [
  { date: "2026-09-06", description: "Miscellaneous + chain", amountPaise: 419100 },
  { date: "2026-09-06", description: "Food", amountPaise: 158000 },
  { date: "2026-09-06", description: "Simla/grocery", amountPaise: 140000 },
];

const txn = db.transaction(() => {
  for (const t of TARGETS) {
    const expense = db
      .prepare("SELECT id FROM expenses WHERE business_date = ? AND description = ? AND amount_paise = ?")
      .get(t.date, t.description, t.amountPaise) as { id: string } | undefined;
    if (!expense) {
      console.error(`Not found (already fixed or never imported): ${t.date} ${t.description}`);
      continue;
    }

    // Re-tag the expense itself.
    db.prepare("UPDATE expenses SET payment_method_id = ? WHERE id = ?").run(UPI, expense.id);

    // Remove the wrongly-posted cash outflow.
    const removed = db
      .prepare("DELETE FROM cash_transactions WHERE reference_type = 'EXPENSE' AND reference_id = ?")
      .run(expense.id);
    if (removed.changes !== 1) {
      throw new Error(`Expected exactly one cash_transaction for expense ${expense.id}, found ${removed.changes}`);
    }

    // Post the equivalent bank debit instead.
    db.prepare(
      `INSERT INTO bank_transactions
        (id, business_date, txn_type, amount_paise, description, category, payment_method_id, reconciled, created_by, created_at)
       VALUES (?, ?, 'DEBIT', ?, ?, 'BUSINESS', ?, 0, ?, ?)`
    ).run(newId("bank"), t.date, t.amountPaise, `${t.description} (corrected: paid via UPI, not cash)`, UPI, ADMIN, nowIso());
  }

  // Recompute the cash/bank snapshot on every affected daily_closings row.
  const affected = db
    .prepare("SELECT business_date FROM daily_closings WHERE business_date >= '2026-09-06' ORDER BY business_date")
    .all() as { business_date: string }[];

  for (const { business_date } of affected) {
    const cashRows = db
      .prepare("SELECT direction, amount_paise FROM cash_transactions WHERE business_date <= ?")
      .all(business_date) as { direction: "IN" | "OUT"; amount_paise: number }[];
    const expectedCash = cashRows.reduce((s, r) => s + (r.direction === "IN" ? r.amount_paise : -r.amount_paise), 0);
    const bankBalance = getBankBalancePaise(business_date);

    const row = db
      .prepare("SELECT actual_cash_paise FROM daily_closings WHERE business_date = ?")
      .get(business_date) as { actual_cash_paise: number | null };
    const diff = row.actual_cash_paise != null ? row.actual_cash_paise - expectedCash : null;

    db.prepare(
      "UPDATE daily_closings SET expected_cash_paise = ?, bank_balance_paise = ?, cash_difference_paise = ?, updated_at = ? WHERE business_date = ?"
    ).run(expectedCash, bankBalance, diff, nowIso(), business_date);
  }
});
txn();

console.log("✓ 06-Sept payment-method correction applied and downstream daily_closings recomputed.");
