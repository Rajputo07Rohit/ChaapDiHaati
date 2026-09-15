import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import { todayBusinessDate } from "../../utils/ids";
import * as closingService from "./dailyClosing.service";

export const dailyClosingRouter = Router();

dailyClosingRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const businessDate = (req.query.businessDate as string) || todayBusinessDate();
    const closing = await closingService.getClosing(businessDate);
    const preview = await closingService.buildClosingSnapshot(businessDate);
    res.json({ closing: closing ?? null, preview });
  })
);

const openSchema = z.object({ businessDate: z.string().optional(), openingCashPaise: z.number().int().min(0) });

dailyClosingRouter.post(
  "/open",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = openSchema.parse(req.body);
    const businessDate = input.businessDate || todayBusinessDate();
    const closing = await closingService.openBusinessDay(businessDate, input.openingCashPaise, req.user!.id);
    res.status(201).json({ closing });
  })
);

const closeSchema = z.object({
  businessDate: z.string().optional(),
  actualCashPaise: z.number().int().min(0),
  cashDiffReason: z.string().optional(),
  notes: z.string().optional(),
});

dailyClosingRouter.post(
  "/close",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = closeSchema.parse(req.body);
    const businessDate = input.businessDate || todayBusinessDate();
    const closing = await closingService.closeDay({ ...input, businessDate, userId: req.user!.id });
    res.json({ closing });
  })
);

const reopenSchema = z.object({ businessDate: z.string(), reason: z.string().min(1) });

dailyClosingRouter.post(
  "/reopen",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = reopenSchema.parse(req.body);
    const closing = await closingService.reopenDay(input.businessDate, input.reason, req.user!.id);
    res.json({ closing });
  })
);
