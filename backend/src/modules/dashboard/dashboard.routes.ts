import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { isManagerUp } from "../../middleware/rbac";
import { getDashboard } from "./dashboard.service";

export const dashboardRouter = Router();

dashboardRouter.get("/", requireAuth, isManagerUp, (_req, res) => {
  res.json(getDashboard());
});
