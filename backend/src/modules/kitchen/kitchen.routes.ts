import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAnyRole } from "../../middleware/rbac";
import * as ordersService from "../orders/orders.service";

export const kitchenRouter = Router();

kitchenRouter.get("/orders", requireAuth, isAnyRole, (_req, res) => {
  const orders = db
    .prepare(
      `SELECT * FROM sales_orders WHERE status IN ('CONFIRMED','PREPARING','READY') ORDER BY created_at ASC`
    )
    .all();
  const withItems = (orders as { id: string }[]).map((o) => ({
    ...o,
    items: db.prepare("SELECT * FROM sales_order_items WHERE sales_order_id = ? AND status = 'ACTIVE'").all(o.id),
  }));
  res.json({ orders: withItems });
});

const statusSchema = z.object({ kitchenStatus: z.enum(["NOT_SENT", "PREPARING", "READY", "SERVED"]) });

kitchenRouter.patch(
  "/orders/:id/status",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = statusSchema.parse(req.body);
    const order = ordersService.updateKitchenStatus(req.params.id, input.kitchenStatus, req.user!.id);
    res.json({ order });
  })
);
