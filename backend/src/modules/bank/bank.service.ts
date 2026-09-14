import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { NotFoundError, ValidationError } from "../../utils/errors";

export type BankCategory = "BUSINESS" | "PERSONAL" | "TRANSFER" | "SUPPLIER" | "SALARY" | "REPAIR" | "UNKNOWN";

export interface RecordBankTxnInput {
  businessDate: string;
  txnType: "CREDIT" | "DEBIT";
  amountPaise: number;
  description: string;
  reference?: string | null;
  category?: BankCategory;
  paymentMethodId?: string | null;
  userId: string | null;
}

const insertStmt = db.prepare(`
  INSERT INTO bank_transactions
    (id, business_date, txn_type, amount_paise, description, reference, category, payment_method_id, reconciled, created_by, created_at)
  VALUES
    (@id, @businessDate, @txnType, @amountPaise, @description, @reference, @category, @paymentMethodId, 0, @createdBy, @createdAt)
`);

export function recordBankTransaction(input: RecordBankTxnInput): string {
  if (input.amountPaise <= 0) throw new ValidationError("Bank amount must be greater than zero.");
  const id = newId("bank");
  insertStmt.run({
    id,
    businessDate: input.businessDate,
    txnType: input.txnType,
    amountPaise: input.amountPaise,
    description: input.description,
    reference: input.reference ?? null,
    category: input.category ?? "UNKNOWN",
    paymentMethodId: input.paymentMethodId ?? null,
    createdBy: input.userId,
    createdAt: nowIso(),
  });
  return id;
}

/** Bank balance = opening + credits - debits. Never derived as sales - purchases. */
export function getBankBalancePaise(asOfDate?: string): number {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'bank_opening_balance_paise'").get() as
    | { value: string }
    | undefined;
  const opening = settingRow ? parseInt(JSON.parse(settingRow.value), 10) : 0;

  let sql = "SELECT txn_type, SUM(amount_paise) as total FROM bank_transactions";
  const params: unknown[] = [];
  if (asOfDate) {
    sql += " WHERE business_date <= ?";
    params.push(asOfDate);
  }
  sql += " GROUP BY txn_type";
  const rows = db.prepare(sql).all(...params) as { txn_type: "CREDIT" | "DEBIT"; total: number }[];

  let balance = opening;
  for (const r of rows) {
    balance += r.txn_type === "CREDIT" ? r.total : -r.total;
  }
  return balance;
}

/**
 * Compares the computed ledger balance against the last real bank statement
 * figure the owner has confirmed (stored in settings, not invented). Used to
 * show "Ledger Balance" vs "Reported Statement Balance" instead of
 * presenting the ledger sum as a confident "Available" figure when it may
 * be incomplete past the last confirmed date.
 */
export function getBankReconciliationStatus() {
  const balanceRow = db.prepare("SELECT value FROM settings WHERE key = 'bank_statement_confirmed_balance_paise'").get() as
    | { value: string }
    | undefined;
  const dateRow = db.prepare("SELECT value FROM settings WHERE key = 'bank_statement_confirmed_date'").get() as
    | { value: string }
    | undefined;

  if (!balanceRow || !dateRow) {
    return { hasStatement: false as const, reconciliationPending: true as const };
  }

  const statementBalancePaise = parseInt(JSON.parse(balanceRow.value), 10);
  const statementDate = JSON.parse(dateRow.value) as string;
  const ledgerBalanceAsOfStatement = getBankBalancePaise(statementDate);
  const differencePaise = statementBalancePaise - ledgerBalanceAsOfStatement;
  const today = new Date().toISOString().slice(0, 10);

  return {
    hasStatement: true as const,
    statementDate,
    statementBalancePaise,
    ledgerBalanceAsOfStatementPaise: ledgerBalanceAsOfStatement,
    differencePaise,
    // Anything recorded after the last confirmed statement date hasn't been
    // checked against a real bank statement yet.
    reconciliationPending: statementDate < today,
  };
}

export function getUnreconciledTransactions() {
  return db
    .prepare("SELECT * FROM bank_transactions WHERE reconciled = 0 ORDER BY business_date DESC")
    .all();
}

export function reconcileTransaction(
  bankTxnId: string,
  data: { linkedReferenceType?: string; linkedReferenceId?: string; category?: BankCategory; notes?: string },
  userId: string
) {
  const existing = db.prepare("SELECT * FROM bank_transactions WHERE id = ?").get(bankTxnId) as
    | Record<string, unknown>
    | undefined;
  if (!existing) throw new NotFoundError("Bank transaction");

  db.prepare(
    `UPDATE bank_transactions
     SET reconciled = 1, linked_reference_type = ?, linked_reference_id = ?, category = COALESCE(?, category), notes = COALESCE(?, notes)
     WHERE id = ?`
  ).run(
    data.linkedReferenceType ?? null,
    data.linkedReferenceId ?? null,
    data.category ?? null,
    data.notes ?? null,
    bankTxnId
  );

  recordAudit({
    userId,
    action: "BANK_RECONCILED",
    entityType: "bank_transaction",
    entityId: bankTxnId,
    oldValue: existing,
    newValue: data,
  });
}
