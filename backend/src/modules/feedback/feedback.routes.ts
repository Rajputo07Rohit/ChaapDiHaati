import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isManagerUp } from "../../middleware/rbac";
import { listFeedback, listProblemCheckouts } from "../customerOrders/customerOrders.service";

/** Staff: customers' private order ratings, and online payments that never became an order. */
export const feedbackRouter = Router();

feedbackRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json(await listFeedback());
  })
);

feedbackRouter.get(
  "/payment-issues",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ checkouts: await listProblemCheckouts() });
  })
);
