import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { isManagerUp, isAdmin } from "../../middleware/rbac";
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

reportsRouter.get("/sales/daily", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.dailySalesReport(from, to) });
});

reportsRouter.get("/sales/item-wise", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.itemWiseSalesReport(from, to) });
});

reportsRouter.get("/sales/category", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.categorySalesReport(from, to) });
});

reportsRouter.get("/sales/payment-method", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.paymentMethodReport(from, to) });
});

reportsRouter.get("/profit-loss", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json(reports.profitLossReport(from, to));
});

reportsRouter.get("/inventory-valuation", requireAuth, isManagerUp, (_req, res) => {
  res.json({ rows: reports.inventoryValuationReport() });
});

reportsRouter.get("/purchases", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.purchaseReport(from, to) });
});

reportsRouter.get("/expenses", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.expenseReport(from, to) });
});

reportsRouter.get("/stock-movement", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.stockMovementReport(from, to, req.query.itemId as string | undefined) });
});

reportsRouter.get("/wastage", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.wastageReport(from, to) });
});

reportsRouter.get("/best-selling", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.bestSellingItemsReport(from, to) });
});

reportsRouter.get("/top-selling-register", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.topSellingItemsRegisterReport(from, to) });
});

reportsRouter.get("/top-purchased", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.topPurchasedItemsReport(from, to) });
});

reportsRouter.get("/menu-profitability", requireAuth, isAdmin, (_req, res) => {
  res.json({ rows: reports.menuItemProfitabilityReport() });
});

reportsRouter.get("/highest-profit", requireAuth, isManagerUp, (req, res) => {
  const { from, to } = range(req);
  res.json({ rows: reports.highestProfitItemsReport(from, to) });
});

reportsRouter.get("/low-stock", requireAuth, isManagerUp, (_req, res) => {
  res.json({ rows: reports.lowStockReport() });
});
