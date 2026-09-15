import { EXPENSE_CATEGORIES, Expense, ExpenseDoc, PaymentMethod } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
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
  vendor: string | null;
  status: string;
  void_reason: string | null;
}

function toRow(doc: ExpenseDoc): ExpenseRow {
  return {
    id: doc._id,
    business_date: doc.businessDate,
    category: doc.category,
    description: doc.description,
    amount_paise: doc.amountPaise,
    payment_method_id: doc.paymentMethodId,
    vendor: doc.vendor,
    status: doc.status,
    void_reason: doc.voidReason,
  };
}

export async function getExpenseOrThrow(id: string): Promise<ExpenseRow> {
  const doc = await Expense.findById(id);
  if (!doc) throw new NotFoundError("Expense");
  return toRow(doc);
}

export async function listExpenses(filters: { businessDate?: string; from?: string; to?: string; category?: string } = {}) {
  const query: Record<string, unknown> = {};
  if (filters.businessDate) query.businessDate = filters.businessDate;
  if (filters.from && filters.to) query.businessDate = { $gte: filters.from, $lte: filters.to };
  if (filters.category) query.category = filters.category;

  const docs = await Expense.find(query).sort({ businessDate: -1, createdAt: -1 });
  const methodIds = [...new Set(docs.map((d) => d.paymentMethodId))];
  const methods = await PaymentMethod.find({ _id: { $in: methodIds } });
  const byId = new Map(methods.map((m) => [m._id, m.name]));

  return docs.map((d) => ({ ...toRow(d), payment_method_name: byId.get(d.paymentMethodId) ?? "" }));
}

export async function recordExpense(input: ExpenseInput, userId: string, role: Role): Promise<ExpenseRow> {
  if (input.amountPaise <= 0) throw new ValidationError("Expense amount must be greater than zero.");
  const businessDate = input.businessDate || todayBusinessDate();
  await assertBusinessDateWritable(businessDate, role);
  const method = await getPaymentMethodOrThrow(input.paymentMethodId);

  const id = newId("exp");
  const now = nowIso();

  await withTransaction(async (session) => {
    await Expense.create(
      [
        {
          _id: id,
          businessDate,
          category: input.category as (typeof EXPENSE_CATEGORIES)[number],
          description: input.description,
          amountPaise: input.amountPaise,
          paymentMethodId: input.paymentMethodId,
          vendor: input.vendor ?? null,
          receiptRef: input.receiptRef ?? null,
          notes: input.notes ?? null,
          status: "RECORDED",
          createdBy: userId,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session }
    );

    if (method.type === "CASH") {
      await recordCashTransaction(
        { businessDate, txnType: "EXPENSE", direction: "OUT", amountPaise: input.amountPaise, referenceType: "EXPENSE", referenceId: id, userId },
        session
      );
    } else {
      await recordBankTransaction(
        {
          businessDate,
          txnType: "DEBIT",
          amountPaise: input.amountPaise,
          description: `${input.category}: ${input.description}`,
          category: input.category === "Staff" ? "SALARY" : input.category === "Repair" ? "REPAIR" : "BUSINESS",
          paymentMethodId: input.paymentMethodId,
          userId,
        },
        session
      );
    }

    await recordAudit(
      { userId, action: "EXPENSE_RECORDED", entityType: "expense", entityId: id, newValue: { category: input.category, amountPaise: input.amountPaise } },
      session
    );
  });

  return getExpenseOrThrow(id);
}

export async function voidExpense(id: string, reason: string, userId: string): Promise<ExpenseRow> {
  if (!reason) throw new ValidationError("A reason is required to void an expense.");
  const expense = await Expense.findById(id);
  if (!expense) throw new NotFoundError("Expense");
  if (expense.status === "VOID") throw new ConflictError("Expense is already void.");

  const method = await getPaymentMethodOrThrow(expense.paymentMethodId);
  const now = nowIso();

  await withTransaction(async (session) => {
    expense.status = "VOID";
    expense.voidReason = reason;
    expense.updatedAt = now;
    await expense.save({ session });

    if (method.type === "CASH") {
      await recordCashTransaction(
        {
          businessDate: expense.businessDate,
          txnType: "ADJUSTMENT",
          direction: "IN",
          amountPaise: expense.amountPaise,
          referenceType: "EXPENSE_VOID",
          referenceId: id,
          reason: `Expense voided: ${reason}`,
          userId,
        },
        session
      );
    }

    await recordAudit({ userId, action: "EXPENSE_VOIDED", entityType: "expense", entityId: id, reason }, session);
  });

  return getExpenseOrThrow(id);
}
