import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { ValidationError } from "../../utils/errors";

export type CashTxnType =
  | "OPENING"
  | "SALE"
  | "EXPENSE"
  | "PURCHASE"
  | "WITHDRAWAL"
  | "DEPOSIT"
  | "ADJUSTMENT"
  | "REFUND";

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

const insertStmt = db.prepare(`
  INSERT INTO cash_transactions
    (id, business_date, txn_type, direction, amount_paise, reference_type, reference_id, reason, created_by, created_at)
  VALUES
    (@id, @businessDate, @txnType, @direction, @amountPaise, @referenceType, @referenceId, @reason, @createdBy, @createdAt)
`);

const REASON_REQUIRED: CashTxnType[] = ["ADJUSTMENT"];

export function recordCashTransaction(input: RecordCashTxnInput): string {
  if (input.amountPaise <= 0) throw new ValidationError("Cash amount must be greater than zero.");
  if (REASON_REQUIRED.includes(input.txnType) && !input.reason) {
    throw new ValidationError("A reason is required for a manual cash adjustment.");
  }
  const id = newId("cash");
  insertStmt.run({
    id,
    businessDate: input.businessDate,
    txnType: input.txnType,
    direction: input.direction,
    amountPaise: input.amountPaise,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    reason: input.reason ?? null,
    createdBy: input.userId,
    createdAt: nowIso(),
  });
  return id;
}

/**
 * Expected cash = opening + sales(IN) + withdrawals(IN, cash added back from
 * bank) - expenses(OUT) - purchases(OUT) - deposits(OUT, cash sent to bank)
 * (+/-) adjustments, for all transactions up to and including businessDate.
 */
export function getCashLedgerSummary(businessDate: string) {
  const rows = db
    .prepare("SELECT * FROM cash_transactions WHERE business_date <= ? ORDER BY created_at ASC")
    .all(businessDate) as {
    id: string;
    txn_type: CashTxnType;
    direction: "IN" | "OUT";
    amount_paise: number;
    business_date: string;
    reason: string | null;
    created_at: string;
  }[];

  let balance = 0;
  const byType: Record<string, number> = {};
  for (const r of rows) {
    const signed = r.direction === "IN" ? r.amount_paise : -r.amount_paise;
    balance += signed;
    byType[r.txn_type] = (byType[r.txn_type] ?? 0) + signed;
  }

  const todayRows = rows.filter((r) => r.business_date === businessDate);
  return { expectedCashPaise: balance, byType, transactions: rows, todayTransactions: todayRows };
}
