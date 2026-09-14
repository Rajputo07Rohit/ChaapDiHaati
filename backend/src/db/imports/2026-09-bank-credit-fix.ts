/**
 * Root-cause fix for the dashboard showing "Bank / Online Available:
 * -₹59,985.79".
 *
 * This was NOT a calculation bug — getBankBalancePaise() already computes
 * opening + credits - debits from the real bank_transactions ledger, never
 * sales-minus-purchases. The negative number was a DATA gap: every real
 * purchase/expense/personal-transfer DEBIT from the 4-12 Sept register was
 * imported, but the matching online/UPI/Paytm sale CREDITS that actually
 * landed in the bank account were never posted — only cash sales got a
 * ledger entry (via cash_transactions), because no per-day bank-settlement
 * confirmation existed for the online portion.
 *
 * The owner's own master data DOES include one real, confirmed bank-
 * statement fact for this: total credits of ₹40,373.86 for the 04-10 Sept
 * statement window (alongside the already-loaded opening balance ₹5,253.21
 * and total debits ₹31,258.00). This script posts that one confirmed
 * figure as a single dated CREDIT — it is real reported data, not a guess.
 *
 * It does NOT attempt to guess daily Paytm-to-bank settlement amounts or
 * dates (UPI settlement lags a day or two in practice, and the owner's own
 * daily Paytm total for 04-10 Sept, ₹46,058, is well above the confirmed
 * ₹40,373.86 bank credit — proof some of it genuinely hadn't settled by
 * 10-Sept). Nor does it touch 11-Sept onward, where no bank statement
 * confirmation exists at all. Those gaps are real and should show as
 * "reconciliation pending" in the UI, not be papered over.
 *
 * Usage: npx tsx src/db/imports/2026-09-bank-credit-fix.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { recordBankTransaction, getBankBalancePaise } = require("../../modules/bank/bank.service") as typeof import("../../modules/bank/bank.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;

const already = db
  .prepare("SELECT id FROM bank_transactions WHERE description LIKE '%bank statement credit total%'")
  .get();
if (already) {
  console.log("Statement-total credit already posted — skipping.");
} else {
  const id = recordBankTransaction({
    businessDate: "2026-09-10",
    txnType: "CREDIT",
    amountPaise: 4037386, // ₹40,373.86 — real reported bank statement total, 04-10 Sept
    description: "Bank statement credit total, 04-10 Sept (Paytm/UPI settlements + other credits) — from owner's bank statement summary, not itemised per day",
    category: "BUSINESS",
    userId: ADMIN,
  });
  db.prepare("UPDATE bank_transactions SET notes = ? WHERE id = ?").run(
    "Confirmed real figure from owner's bank statement (opening ₹5,253.21, total credits ₹40,373.86, total debits ₹31,258.00, closing ₹14,369.07 CR through 10-Sept). Posted as one lump credit because no day-by-day settlement breakdown was given — daily Paytm totals for this window sum to ₹46,058, higher than this confirmed credit figure, meaning some settlements genuinely hadn't cleared by 10-Sept. Do not treat this ledger balance as fully reconciled past 10-Sept.",
    id
  );
  console.log("Posted the confirmed ₹40,373.86 bank statement credit total for 04-10 Sept.");
}

const balance = getBankBalancePaise();
console.log(`\nBank ledger balance now: ₹${(balance / 100).toFixed(2)}`);
console.log("This is a real ledger balance built from confirmed transactions — NOT sales minus purchases.");
console.log("It is still INCOMPLETE for 11-Sept onward (no bank statement confirmation exists past 10-Sept) — flag as reconciliation pending in the UI, don't present as a confident 'available' figure.");
