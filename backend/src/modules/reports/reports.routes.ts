import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { isManagerUp, isAdmin } from "../../middleware/rbac";
import { asyncHandler } from "../../utils/asyncHandler";
import { todayBusinessDate } from "../../utils/ids";
import * as reports from "./reports.service";

export const reportsRouter = Router();

function range(req: import("express").Request) {
  const today = todayBusinessDate();
  return {
    from: (req.query.from as string) || today,
    to: (req.query.to as string) || today,
  };
}

reportsRouter.get(
  "/sales/daily",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.dailySalesReport(from, to) });
  })
);

reportsRouter.get(
  "/sales/item-wise",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.itemWiseSalesReport(from, to) });
  })
);

reportsRouter.get(
  "/sales/category",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.categorySalesReport(from, to) });
  })
);

reportsRouter.get(
  "/sales/payment-method",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.paymentMethodReport(from, to) });
  })
);

reportsRouter.get(
  "/profit-loss",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json(await reports.profitLossReport(from, to));
  })
);

reportsRouter.get(
  "/inventory-valuation",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ rows: await reports.inventoryValuationReport() });
  })
);

reportsRouter.get(
  "/purchases",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.purchaseReport(from, to) });
  })
);

reportsRouter.get(
  "/expenses",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.expenseReport(from, to) });
  })
);

reportsRouter.get(
  "/stock-movement",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.stockMovementReport(from, to, req.query.itemId as string | undefined) });
  })
);

reportsRouter.get(
  "/wastage",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.wastageReport(from, to) });
  })
);

reportsRouter.get(
  "/best-selling",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.bestSellingItemsReport(from, to) });
  })
);

reportsRouter.get(
  "/top-selling-register",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.topSellingItemsRegisterReport(from, to) });
  })
);

reportsRouter.get(
  "/top-purchased",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.topPurchasedItemsReport(from, to) });
  })
);

reportsRouter.get(
  "/menu-profitability",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ rows: await reports.menuItemProfitabilityReport() });
  })
);

reportsRouter.get(
  "/highest-profit",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const { from, to } = range(req);
    res.json({ rows: await reports.highestProfitItemsReport(from, to) });
  })
);

reportsRouter.get(
  "/low-stock",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ rows: await reports.lowStockReport() });
  })
);
