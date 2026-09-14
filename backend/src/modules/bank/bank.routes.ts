import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { todayBusinessDate } from "../../utils/ids";
import * as bankService from "./bank.service";

export const bankRouter = Router();

bankRouter.get(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const asOf = (req.query.asOf as string) || todayBusinessDate();
    const balance = bankService.getBankBalancePaise(asOf);
    const transactions = db
      .prepare("SELECT * FROM bank_transactions WHERE business_date <= ? ORDER BY business_date DESC, created_at DESC LIMIT 200")
      .all(asOf);
    res.json({ balancePaise: balance, transactions, reconciliation: bankService.getBankReconciliationStatus() });
  })
);

bankRouter.get("/unreconciled", requireAuth, isAdmin, (_req, res) => {
  res.json({ transactions: bankService.getUnreconciledTransactions() });
});

const createTxnSchema = z.object({
  businessDate: z.string(),
  txnType: z.enum(["CREDIT", "DEBIT"]),
  amountPaise: z.number().int().positive(),
  description: z.string().min(1),
  reference: z.string().optional(),
  category: z.enum(["BUSINESS", "PERSONAL", "TRANSFER", "SUPPLIER", "SALARY", "REPAIR", "UNKNOWN"]).optional(),
});

bankRouter.post(
  "/transaction",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createTxnSchema.parse(req.body);
    const id = bankService.recordBankTransaction({ ...input, userId: req.user!.id });
    res.status(201).json({ id });
  })
);

const reconcileSchema = z.object({
  linkedReferenceType: z.string().optional(),
  linkedReferenceId: z.string().optional(),
  category: z.enum(["BUSINESS", "PERSONAL", "TRANSFER", "SUPPLIER", "SALARY", "REPAIR", "UNKNOWN"]).optional(),
  notes: z.string().optional(),
});

bankRouter.post(
  "/reconcile/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = reconcileSchema.parse(req.body);
    bankService.reconcileTransaction(req.params.id, input, req.user!.id);
    res.json({ ok: true });
  })
);
