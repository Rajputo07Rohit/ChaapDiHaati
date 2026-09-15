import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isManagerUp } from "../../middleware/rbac";
import { getDashboard } from "./dashboard.service";

export const dashboardRouter = Router();

dashboardRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json(await getDashboard());
  })
);
