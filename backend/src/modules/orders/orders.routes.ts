import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAnyRole, isManagerUp } from "../../middleware/rbac";
import * as ordersService from "./orders.service";

export const ordersRouter = Router();

const orderItemSchema = z.object({
  menuItemId: z.string(),
  priceType: z.enum(["HALF", "FULL", "SINGLE"]),
  quantity: z.number().int().positive(),
  specialInstructions: z.string().optional(),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountValue: z.number().min(0).optional(),
});

const createOrderSchema = z.object({
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"]),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountValue: z.number().min(0).optional(),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
  businessDate: z.string().optional(),
  asDraft: z.boolean().optional(),
});

ordersRouter.get(
  "/",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const orders = ordersService.listOrders({
      status: req.query.status as string | undefined,
      businessDate: req.query.businessDate as string | undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    });
    res.json({ orders });
  })
);

ordersRouter.get(
  "/:id",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    res.json({ order: ordersService.getOrderFull(req.params.id) });
  })
);

ordersRouter.post(
  "/",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = createOrderSchema.parse(req.body);
    const order = ordersService.createOrder(input, req.user!.id, req.user!.role);
    res.status(201).json({ order: ordersService.getOrderFull(order.id) });
  })
);

const updateOrderSchema = z.object({
  items: z.array(orderItemSchema).min(1),
  discountType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  discountValue: z.number().min(0).optional(),
  discountReason: z.string().optional(),
  notes: z.string().optional(),
});

ordersRouter.patch(
  "/:id",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = updateOrderSchema.parse(req.body);
    const order = ordersService.updateOrderItems(
      req.params.id,
      { ...input, orderType: "DINE_IN" },
      req.user!.id,
      req.user!.role
    );
    res.json({ order: ordersService.getOrderFull(order.id) });
  })
);

const cancelSchema = z.object({ reason: z.string().min(1) });

ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = cancelSchema.parse(req.body);
    const order = ordersService.cancelOrder(req.params.id, input.reason, req.user!.id, req.user!.role);
    res.json({ order });
  })
);

const completeSchema = z.object({
  payments: z
    .array(
      z.object({
        paymentMethodId: z.string(),
        amountPaise: z.number().int().positive(),
        reference: z.string().optional(),
      })
    )
    .default([]),
  allowNegativeStock: z.boolean().optional(),
  overrideReason: z.string().optional(),
});

ordersRouter.post(
  "/:id/complete",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = completeSchema.parse(req.body);
    const order = ordersService.completeOrder(req.params.id, input, req.user!.id, req.user!.role);
    res.json({ order: ordersService.getOrderFull(order.id) });
  })
);

const refundSchema = z.object({
  amountPaise: z.number().int().positive(),
  reason: z.string().min(1),
  refundType: z.enum(["FULL", "PARTIAL"]),
  paymentMethodId: z.string(),
});

ordersRouter.post(
  "/:id/refund",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = refundSchema.parse(req.body);
    const order = ordersService.refundOrder(req.params.id, input, req.user!.id, req.user!.role);
    res.json({ order });
  })
);
