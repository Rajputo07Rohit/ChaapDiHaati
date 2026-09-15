import { Router } from "express";
import { z } from "zod";
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
    const balance = await bankService.getBankBalancePaise(asOf);
    const transactions = await bankService.listBankTransactions(asOf);
    res.json({ balancePaise: balance, transactions, reconciliation: await bankService.getBankReconciliationStatus() });
  })
);

bankRouter.get(
  "/unreconciled",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ transactions: await bankService.getUnreconciledTransactions() });
  })
);

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
    const id = await bankService.recordBankTransaction({ ...input, userId: req.user!.id });
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
    await bankService.reconcileTransaction(req.params.id, input, req.user!.id);
    res.json({ ok: true });
  })
);
