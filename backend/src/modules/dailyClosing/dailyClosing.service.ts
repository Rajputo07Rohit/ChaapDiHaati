import { DailyClosing, DailyClosingDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
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

function toRow(doc: DailyClosingDoc): DailyClosingRow {
  return {
    id: doc._id,
    business_date: doc.businessDate,
    status: doc.status,
    opening_cash_paise: doc.openingCashPaise,
    gross_sales_paise: doc.grossSalesPaise,
    discounts_paise: doc.discountsPaise,
    net_sales_paise: doc.netSalesPaise,
    cogs_paise: doc.cogsPaise,
    gross_profit_paise: doc.grossProfitPaise,
    expenses_paise: doc.expensesPaise,
    net_profit_paise: doc.netProfitPaise,
    expected_cash_paise: doc.expectedCashPaise,
    actual_cash_paise: doc.actualCashPaise,
    cash_difference_paise: doc.cashDifferencePaise,
    cash_diff_reason: doc.cashDiffReason,
    bank_balance_paise: doc.bankBalancePaise,
    stock_value_paise: doc.stockValuePaise,
    closed_by: doc.closedBy,
    closed_at: doc.closedAt,
  };
}

export async function getClosing(businessDate: string): Promise<DailyClosingRow | undefined> {
  const doc = await DailyClosing.findOne({ businessDate });
  return doc ? toRow(doc) : undefined;
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
export async function openBusinessDay(businessDate: string, openingCashPaise: number, userId: string): Promise<DailyClosingRow> {
  const existing = await getClosing(businessDate);
  if (existing) return existing;

  const isVeryFirstDay = (await DailyClosing.countDocuments()) === 0;

  await withTransaction(async (session) => {
    const id = newId("close");
    const now = nowIso();
    await DailyClosing.create(
      [{ _id: id, businessDate, status: "OPEN", openingCashPaise, openedBy: userId, createdAt: now, updatedAt: now }],
      { session }
    );

    if (isVeryFirstDay && openingCashPaise > 0) {
      await recordCashTransaction(
        { businessDate, txnType: "OPENING", direction: "IN", amountPaise: openingCashPaise, reason: "Starting cash float — system bootstrap", userId },
        session
      );
    }

    await recordAudit(
      { userId, action: "DAY_OPENED", entityType: "daily_closing", entityId: id, newValue: { businessDate, openingCashPaise, injectedOpeningTxn: isVeryFirstDay } },
      session
    );
  });

  return (await getClosing(businessDate))!;
}

export async function buildClosingSnapshot(businessDate: string) {
  const sales = await getSalesSummary(businessDate, businessDate);
  const expenses = await getExpensesTotal(businessDate, businessDate);
  const grossProfit = sales.netSalesPaise - sales.cogsPaise;
  const netProfit = grossProfit - expenses;
  const cash = await getCashLedgerSummary(businessDate);
  const bankBalance = await getBankBalancePaise(businessDate);
  const stockValue = await getStockValuePaise();

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

export async function closeDay(input: CloseDayInput): Promise<DailyClosingRow> {
  const closing = await DailyClosing.findOne({ businessDate: input.businessDate });
  if (!closing) throw new NotFoundError("Business day (open it first)");
  if (closing.status === "CLOSED") throw new ConflictError(`${input.businessDate} is already closed.`);

  const snap = await buildClosingSnapshot(input.businessDate);
  const diff = input.actualCashPaise - snap.expectedCashPaise;
  if (diff !== 0 && !input.cashDiffReason) {
    throw new ValidationError(`Cash ${diff > 0 ? "excess" : "shortage"} of ${Math.abs(diff)} paise detected. A reason is required before closing.`);
  }

  await withTransaction(async (session) => {
    const now = nowIso();
    closing.status = "CLOSED";
    closing.grossSalesPaise = snap.grossSalesPaise;
    closing.discountsPaise = snap.discountsPaise;
    closing.netSalesPaise = snap.netSalesPaise;
    closing.cogsPaise = snap.cogsPaise;
    closing.grossProfitPaise = snap.grossProfitPaise;
    closing.expensesPaise = snap.expensesPaise;
    closing.netProfitPaise = snap.netProfitPaise;
    closing.expectedCashPaise = snap.expectedCashPaise;
    closing.actualCashPaise = input.actualCashPaise;
    closing.cashDifferencePaise = diff;
    closing.cashDiffReason = input.cashDiffReason ?? null;
    closing.bankBalancePaise = snap.bankBalancePaise;
    closing.stockValuePaise = snap.stockValuePaise;
    closing.closedBy = input.userId;
    closing.closedAt = now;
    closing.notes = input.notes ?? null;
    closing.updatedAt = now;
    await closing.save({ session });

    await recordAudit(
      {
        userId: input.userId,
        action: "DAY_CLOSED",
        entityType: "daily_closing",
        entityId: closing._id,
        newValue: { ...snap, actualCashPaise: input.actualCashPaise, cashDifferencePaise: diff },
        reason: input.cashDiffReason,
      },
      session
    );
  });

  return (await getClosing(input.businessDate))!;
}

export async function reopenDay(businessDate: string, reason: string, userId: string): Promise<DailyClosingRow> {
  const closing = await DailyClosing.findOne({ businessDate });
  if (!closing) throw new NotFoundError("Business day");
  if (closing.status === "OPEN") throw new ConflictError(`${businessDate} is not closed.`);
  if (!reason) throw new ValidationError("A reason is required to reopen a closed day.");

  await withTransaction(async (session) => {
    const now = nowIso();
    closing.status = "OPEN";
    closing.reopenedBy = userId;
    closing.reopenedAt = now;
    closing.reopenReason = reason;
    closing.updatedAt = now;
    await closing.save({ session });

    await recordAudit(
      { userId, action: "DAY_REOPENED", entityType: "daily_closing", entityId: closing._id, oldValue: { status: "CLOSED" }, newValue: { status: "OPEN" }, reason },
      session
    );
  });

  return (await getClosing(businessDate))!;
}
