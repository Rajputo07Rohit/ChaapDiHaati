import { db } from "../../db/connection";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { assertBusinessDateWritable } from "../../utils/businessDate";
import { recordCashTransaction } from "../cash/cash.service";
import { recordBankTransaction } from "../bank/bank.service";
import { getPaymentMethodOrThrow } from "../paymentMethods/paymentMethods.service";
import { Role } from "../../types/express";

export interface ExpenseInput {
  businessDate?: string;
  category: string;
  description: string;
  amountPaise: number;
  paymentMethodId: string;
  vendor?: string;
  receiptRef?: string;
  notes?: string;
}

export interface ExpenseRow {
  id: string;
  business_date: string;
  category: string;
  description: string;
  amount_paise: number;
  payment_method_id: string;
  status: string;
}

export function getExpenseOrThrow(id: string): ExpenseRow {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow | undefined;
  if (!row) throw new NotFoundError("Expense");
  return row;
}

export function listExpenses(filters: { businessDate?: string; from?: string; to?: string; category?: string } = {}) {
  let sql = "SELECT e.*, pm.name as payment_method_name FROM expenses e JOIN payment_methods pm ON pm.id = e.payment_method_id WHERE 1=1";
  const params: unknown[] = [];
  if (filters.businessDate) {
    sql += " AND e.business_date = ?";
    params.push(filters.businessDate);
  }
  if (filters.from && filters.to) {
    sql += " AND e.business_date BETWEEN ? AND ?";
    params.push(filters.from, filters.to);
  }
  if (filters.category) {
    sql += " AND e.category = ?";
    params.push(filters.category);
  }
  sql += " ORDER BY e.business_date DESC, e.created_at DESC";
  return db.prepare(sql).all(...params);
}

export function recordExpense(input: ExpenseInput, userId: string, role: Role): ExpenseRow {
  if (input.amountPaise <= 0) throw new ValidationError("Expense amount must be greater than zero.");
  const businessDate = input.businessDate || todayBusinessDate();
  assertBusinessDateWritable(businessDate, role);
  const method = getPaymentMethodOrThrow(input.paymentMethodId);

  const id = newId("exp");
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare(
      `INSERT INTO expenses
        (id, business_date, category, description, amount_paise, payment_method_id, vendor, receipt_ref, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      businessDate,
      input.category,
      input.description,
      input.amountPaise,
      input.paymentMethodId,
      input.vendor ?? null,
      input.receiptRef ?? null,
      input.notes ?? null,
      userId,
      now,
      now
    );

    if (method.type === "CASH") {
      recordCashTransaction({
        businessDate,
        txnType: "EXPENSE",
        direction: "OUT",
        amountPaise: input.amountPaise,
        referenceType: "EXPENSE",
        referenceId: id,
        userId,
      });
    } else {
      recordBankTransaction({
        businessDate,
        txnType: "DEBIT",
        amountPaise: input.amountPaise,
        description: `${input.category}: ${input.description}`,
        category: input.category === "Staff" ? "SALARY" : input.category === "Repair" ? "REPAIR" : "BUSINESS",
        paymentMethodId: input.paymentMethodId,
        userId,
      });
    }

    recordAudit({
      userId,
      action: "EXPENSE_RECORDED",
      entityType: "expense",
      entityId: id,
      newValue: { category: input.category, amountPaise: input.amountPaise },
    });
  });
  txn();

  return getExpenseOrThrow(id);
}

export function voidExpense(id: string, reason: string, userId: string): ExpenseRow {
  if (!reason) throw new ValidationError("A reason is required to void an expense.");
  const expense = getExpenseOrThrow(id);
  if (expense.status === "VOID") throw new ConflictError("Expense is already void.");

  const method = getPaymentMethodOrThrow(expense.payment_method_id);
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare("UPDATE expenses SET status = 'VOID', void_reason = ?, updated_at = ? WHERE id = ?").run(reason, now, id);

    if (method.type === "CASH") {
      recordCashTransaction({
        businessDate: expense.business_date,
        txnType: "ADJUSTMENT",
        direction: "IN",
        amountPaise: expense.amount_paise,
        referenceType: "EXPENSE_VOID",
        referenceId: id,
        reason: `Expense voided: ${reason}`,
        userId,
      });
    }

    recordAudit({ userId, action: "EXPENSE_VOIDED", entityType: "expense", entityId: id, reason });
  });
  txn();

  return getExpenseOrThrow(id);
}
