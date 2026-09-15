import { ClientSession } from "mongoose";
import { BankTransaction, Setting } from "../../db/models";
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

export async function recordBankTransaction(input: RecordBankTxnInput, session?: ClientSession): Promise<string> {
  if (input.amountPaise <= 0) throw new ValidationError("Bank amount must be greater than zero.");
  const id = newId("bank");
  await BankTransaction.create(
    [
      {
        _id: id,
        businessDate: input.businessDate,
        txnType: input.txnType,
        amountPaise: input.amountPaise,
        description: input.description,
        reference: input.reference ?? null,
        category: input.category ?? "UNKNOWN",
        paymentMethodId: input.paymentMethodId ?? null,
        reconciled: false,
        createdBy: input.userId,
        createdAt: nowIso(),
      },
    ],
    { session }
  );
  return id;
}

/** Bank balance = opening + credits - debits. Never derived as sales - purchases. */
export async function getBankBalancePaise(asOfDate?: string): Promise<number> {
  const settingDoc = await Setting.findById("bank_opening_balance_paise");
  const opening = settingDoc ? parseInt(String(settingDoc.value), 10) : 0;

  const query: Record<string, unknown> = {};
  if (asOfDate) query.businessDate = { $lte: asOfDate };
  const rows = await BankTransaction.aggregate<{ _id: "CREDIT" | "DEBIT"; total: number }>([
    { $match: query },
    { $group: { _id: "$txnType", total: { $sum: "$amountPaise" } } },
  ]);

  let balance = opening;
  for (const r of rows) {
    balance += r._id === "CREDIT" ? r.total : -r.total;
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
export async function getBankReconciliationStatus() {
  const balanceDoc = await Setting.findById("bank_statement_confirmed_balance_paise");
  const dateDoc = await Setting.findById("bank_statement_confirmed_date");

  if (!balanceDoc || !dateDoc) {
    return { hasStatement: false as const, reconciliationPending: true as const };
  }

  const statementBalancePaise = parseInt(String(balanceDoc.value), 10);
  const statementDate = String(dateDoc.value);
  const ledgerBalanceAsOfStatement = await getBankBalancePaise(statementDate);
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

export async function getUnreconciledTransactions() {
  const docs = await BankTransaction.find({ reconciled: false }).sort({ businessDate: -1 });
  return docs.map(toBankRow);
}

function toBankRow(doc: InstanceType<typeof BankTransaction>) {
  return {
    id: doc._id,
    business_date: doc.businessDate,
    txn_type: doc.txnType,
    amount_paise: doc.amountPaise,
    description: doc.description,
    reference: doc.reference,
    category: doc.category,
    payment_method_id: doc.paymentMethodId,
    linked_reference_type: doc.linkedReferenceType,
    linked_reference_id: doc.linkedReferenceId,
    reconciled: doc.reconciled,
    notes: doc.notes,
    created_by: doc.createdBy,
    created_at: doc.createdAt,
  };
}

export async function listBankTransactions(asOfDate: string) {
  const docs = await BankTransaction.find({ businessDate: { $lte: asOfDate } })
    .sort({ businessDate: -1, createdAt: -1 })
    .limit(200);
  return docs.map(toBankRow);
}

export async function reconcileTransaction(
  bankTxnId: string,
  data: { linkedReferenceType?: string; linkedReferenceId?: string; category?: BankCategory; notes?: string },
  userId: string
) {
  const existing = await BankTransaction.findById(bankTxnId);
  if (!existing) throw new NotFoundError("Bank transaction");
  const before = toBankRow(existing);

  existing.reconciled = true;
  existing.linkedReferenceType = data.linkedReferenceType ?? null;
  existing.linkedReferenceId = data.linkedReferenceId ?? null;
  if (data.category !== undefined) existing.category = data.category;
  if (data.notes !== undefined) existing.notes = data.notes;
  await existing.save();

  await recordAudit({
    userId,
    action: "BANK_RECONCILED",
    entityType: "bank_transaction",
    entityId: bankTxnId,
    oldValue: before,
    newValue: data,
  });
}
