import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isAnyRole } from "../../middleware/rbac";
import * as storeStatusService from "./storeStatus.service";

const hhmm = z.string().regex(storeStatusService.TIME_RE, "Use HH:MM (24-hour)");

const dayHours = z.object({ open: z.boolean(), openTime: hhmm, closeTime: hhmm });

const schema = z.object({
  mode: z.enum(["AUTO", "OPEN", "CLOSED"]),
  openTime: hhmm,
  closeTime: hhmm,
  closedMessage: z.string().max(200).default(""),
  days: z.array(dayHours).length(7).optional(),
});

export const storeStatusAdminRouter = Router();

storeStatusAdminRouter.get(
  "/",
  requireAuth,
  isAnyRole,
  asyncHandler(async (_req, res) => {
    res.json(await storeStatusService.getStoreStatus());
  })
);

storeStatusAdminRouter.put(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    await storeStatusService.saveStoreHours(schema.parse(req.body), req.user!.id);
    res.json(await storeStatusService.getStoreStatus());
  })
);

/** Staff/Manager can pause or resume ordering (e.g. out of stock) but can't change the daily schedule or message — that stays admin-only above. */
storeStatusAdminRouter.put(
  "/mode",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const { mode } = z.object({ mode: z.enum(["AUTO", "OPEN", "CLOSED"]) }).parse(req.body);
    const current = await storeStatusService.getStoreHours();
    await storeStatusService.saveStoreHours({ ...current, mode }, req.user!.id);
    res.json(await storeStatusService.getStoreStatus());
  })
);

export const storeStatusPublicRouter = Router();

storeStatusPublicRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const s = await storeStatusService.getStoreStatus();
    res.json({
      isOpen: s.isOpen,
      message: s.message,
      opensAt: s.opensAt,
      openTime: s.todayOpenTime,
      closeTime: s.todayCloseTime,
      mode: s.mode,
      changesInSeconds: s.changesInSeconds,
      nextChangeTime: s.nextChangeTime,
      weekSummary: s.weekSummary,
    });
  })
);
