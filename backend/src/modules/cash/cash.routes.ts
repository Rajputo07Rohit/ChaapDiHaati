import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { todayBusinessDate } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import * as cashService from "./cash.service";

export const cashRouter = Router();

cashRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const businessDate = (req.query.businessDate as string) || todayBusinessDate();
    res.json(await cashService.getCashLedgerSummary(businessDate));
  })
);

const txnSchema = z.object({
  businessDate: z.string().optional(),
  txnType: z.enum(["WITHDRAWAL", "DEPOSIT", "ADJUSTMENT"]),
  direction: z.enum(["IN", "OUT"]),
  amountPaise: z.number().int().positive(),
  reason: z.string().optional(),
});

cashRouter.post(
  "/transaction",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = txnSchema.parse(req.body);
    const businessDate = input.businessDate || todayBusinessDate();
    const id = await cashService.recordCashTransaction({ ...input, businessDate, userId: req.user!.id });
    await recordAudit({
      userId: req.user!.id,
      action: "CASH_ADJUSTMENT",
      entityType: "cash_transaction",
      entityId: id,
      newValue: input,
      reason: input.reason,
    });
    res.status(201).json({ id });
  })
);
