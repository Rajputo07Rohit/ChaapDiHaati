import { ClientSession } from "mongoose";
import { CashTransaction } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { ValidationError } from "../../utils/errors";

export type CashTxnType = "OPENING" | "SALE" | "EXPENSE" | "PURCHASE" | "WITHDRAWAL" | "DEPOSIT" | "ADJUSTMENT" | "REFUND";

export interface RecordCashTxnInput {
  businessDate: string;
  txnType: CashTxnType;
  direction: "IN" | "OUT";
  amountPaise: number;
  referenceType?: string | null;
  referenceId?: string | null;
  reason?: string | null;
  userId: string | null;
}

const REASON_REQUIRED: CashTxnType[] = ["ADJUSTMENT"];

export async function recordCashTransaction(input: RecordCashTxnInput, session?: ClientSession): Promise<string> {
  if (input.amountPaise <= 0) throw new ValidationError("Cash amount must be greater than zero.");
  if (REASON_REQUIRED.includes(input.txnType) && !input.reason) {
    throw new ValidationError("A reason is required for a manual cash adjustment.");
  }
  const id = newId("cash");
  await CashTransaction.create(
    [
      {
        _id: id,
        businessDate: input.businessDate,
        txnType: input.txnType,
        direction: input.direction,
        amountPaise: input.amountPaise,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        createdBy: input.userId,
        createdAt: nowIso(),
      },
    ],
    { session }
  );
  return id;
}

/**
 * Expected cash = opening + sales(IN) + withdrawals(IN, cash added back from
 * bank) - expenses(OUT) - purchases(OUT) - deposits(OUT, cash sent to bank)
 * (+/-) adjustments, for all transactions up to and including businessDate.
 */
export async function getCashLedgerSummary(businessDate: string) {
  const docs = await CashTransaction.find({ businessDate: { $lte: businessDate } }).sort({ createdAt: 1 });

  let balance = 0;
  const byType: Record<string, number> = {};
  const rows = docs.map((r) => ({
    id: r._id,
    txn_type: r.txnType,
    direction: r.direction,
    amount_paise: r.amountPaise,
    business_date: r.businessDate,
    reason: r.reason,
    created_at: r.createdAt,
  }));
  for (const r of rows) {
    const signed = r.direction === "IN" ? r.amount_paise : -r.amount_paise;
    balance += signed;
    byType[r.txn_type] = (byType[r.txn_type] ?? 0) + signed;
  }

  const todayTransactions = rows.filter((r) => r.business_date === businessDate);
  return { expectedCashPaise: balance, byType, transactions: rows, todayTransactions };
}
