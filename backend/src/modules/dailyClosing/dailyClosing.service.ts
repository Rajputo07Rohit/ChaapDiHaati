import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { getSalesSummary, getExpensesTotal } from "../reports/salesAggregate.service";
import { getCashLedgerSummary, recordCashTransaction } from "../cash/cash.service";
import { getBankBalancePaise } from "../bank/bank.service";
import { getStockValuePaise } from "../inventory/inventory.service";

export interface DailyClosingRow {
  id: string;
  business_date: string;
  status: "OPEN" | "CLOSED";
  opening_cash_paise: number;
  gross_sales_paise: number | null;
  discounts_paise: number | null;
  net_sales_paise: number | null;
  cogs_paise: number | null;
  gross_profit_paise: number | null;
  expenses_paise: number | null;
  net_profit_paise: number | null;
  expected_cash_paise: number | null;
  actual_cash_paise: number | null;
  cash_difference_paise: number | null;
  cash_diff_reason: string | null;
  bank_balance_paise: number | null;
  stock_value_paise: number | null;
  closed_by: string | null;
  closed_at: string | null;
}

export function getClosing(businessDate: string): DailyClosingRow | undefined {
  return db.prepare("SELECT * FROM daily_closings WHERE business_date = ?").get(businessDate) as
    | DailyClosingRow
    | undefined;
}

/**
 * Idempotently ensures an OPEN daily_closings row exists for a date.
 *
 * Cash carries forward in the till day to day — it is never reset to zero
 * each morning — so "opening cash" is normally just a snapshot of what the
 * ledger already carried from the previous close, recorded here for display
 * only. A real cash_transaction is only created the very first time the
 * system is ever opened (no prior daily_closings exist at all), which
 * represents the true starting float that pre-dates the ledger. Opening a
 * later day with a DIFFERENT figure than the carried-forward total should go
 * through an explicit cash adjustment instead, so it stays auditable.
 */
export function openBusinessDay(businessDate: string, openingCashPaise: number, userId: string): DailyClosingRow {
  const existing = getClosing(businessDate);
  if (existing) return existing;

  const isVeryFirstDay = (db.prepare("SELECT COUNT(*) as c FROM daily_closings").get() as { c: number }).c === 0;

  const txn = db.transaction(() => {
    const id = newId("close");
    db.prepare(
      `INSERT INTO daily_closings (id, business_date, status, opening_cash_paise, opened_by, created_at, updated_at)
       VALUES (?, ?, 'OPEN', ?, ?, ?, ?)`
    ).run(id, businessDate, openingCashPaise, userId, nowIso(), nowIso());

    if (isVeryFirstDay && openingCashPaise > 0) {
      recordCashTransaction({
        businessDate,
        txnType: "OPENING",
        direction: "IN",
        amountPaise: openingCashPaise,
        reason: "Starting cash float — system bootstrap",
        userId,
      });
    }

    recordAudit({ userId, action: "DAY_OPENED", entityType: "daily_closing", entityId: id, newValue: { businessDate, openingCashPaise, injectedOpeningTxn: isVeryFirstDay } });
  });
  txn();
  return getClosing(businessDate)!;
}

export function buildClosingSnapshot(businessDate: string) {
  const sales = getSalesSummary(businessDate, businessDate);
  const expenses = getExpensesTotal(businessDate, businessDate);
  const grossProfit = sales.netSalesPaise - sales.cogsPaise;
  const netProfit = grossProfit - expenses;
  const cash = getCashLedgerSummary(businessDate);
  const bankBalance = getBankBalancePaise(businessDate);
  const stockValue = getStockValuePaise();

  return {
    grossSalesPaise: sales.grossSalesPaise,
    discountsPaise: sales.discountsPaise,
    netSalesPaise: sales.netSalesPaise,
    cogsPaise: sales.cogsPaise,
    grossProfitPaise: grossProfit,
    expensesPaise: expenses,
    netProfitPaise: netProfit,
    expectedCashPaise: cash.expectedCashPaise,
    bankBalancePaise: bankBalance,
    stockValuePaise: stockValue,
    orderCount: sales.orderCount,
    cashPaise: sales.cashPaise,
    onlinePaise: sales.onlinePaise,
  };
}

export interface CloseDayInput {
  businessDate: string;
  actualCashPaise: number;
  cashDiffReason?: string;
  notes?: string;
  userId: string;
}

export function closeDay(input: CloseDayInput): DailyClosingRow {
  const closing = getClosing(input.businessDate);
  if (!closing) throw new NotFoundError("Business day (open it first)");
  if (closing.status === "CLOSED") throw new ConflictError(`${input.businessDate} is already closed.`);

  const snap = buildClosingSnapshot(input.businessDate);
  const diff = input.actualCashPaise - snap.expectedCashPaise;
  if (diff !== 0 && !input.cashDiffReason) {
    throw new ValidationError(
      `Cash ${diff > 0 ? "excess" : "shortage"} of ${Math.abs(diff)} paise detected. A reason is required before closing.`
    );
  }

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE daily_closings SET
        status = 'CLOSED', gross_sales_paise = ?, discounts_paise = ?, net_sales_paise = ?, cogs_paise = ?,
        gross_profit_paise = ?, expenses_paise = ?, net_profit_paise = ?, expected_cash_paise = ?,
        actual_cash_paise = ?, cash_difference_paise = ?, cash_diff_reason = ?, bank_balance_paise = ?,
        stock_value_paise = ?, closed_by = ?, closed_at = ?, notes = ?, updated_at = ?
       WHERE business_date = ?`
    ).run(
      snap.grossSalesPaise,
      snap.discountsPaise,
      snap.netSalesPaise,
      snap.cogsPaise,
      snap.grossProfitPaise,
      snap.expensesPaise,
      snap.netProfitPaise,
      snap.expectedCashPaise,
      input.actualCashPaise,
      diff,
      input.cashDiffReason ?? null,
      snap.bankBalancePaise,
      snap.stockValuePaise,
      input.userId,
      nowIso(),
      input.notes ?? null,
      nowIso(),
      input.businessDate
    );

    recordAudit({
      userId: input.userId,
      action: "DAY_CLOSED",
      entityType: "daily_closing",
      entityId: closing.id,
      newValue: { ...snap, actualCashPaise: input.actualCashPaise, cashDifferencePaise: diff },
      reason: input.cashDiffReason,
    });
  });
  txn();
  return getClosing(input.businessDate)!;
}

export function reopenDay(businessDate: string, reason: string, userId: string): DailyClosingRow {
  const closing = getClosing(businessDate);
  if (!closing) throw new NotFoundError("Business day");
  if (closing.status === "OPEN") throw new ConflictError(`${businessDate} is not closed.`);
  if (!reason) throw new ValidationError("A reason is required to reopen a closed day.");

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE daily_closings SET status = 'OPEN', reopened_by = ?, reopened_at = ?, reopen_reason = ?, updated_at = ? WHERE business_date = ?`
    ).run(userId, nowIso(), reason, nowIso(), businessDate);

    recordAudit({
      userId,
      action: "DAY_REOPENED",
      entityType: "daily_closing",
      entityId: closing.id,
      oldValue: { status: "CLOSED" },
      newValue: { status: "OPEN" },
      reason,
    });
  });
  txn();
  return getClosing(businessDate)!;
}
