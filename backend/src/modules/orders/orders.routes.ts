import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAnyRole, isAnyRoleOrRider, isManagerUp, isRider } from "../../middleware/rbac";
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
  deliveryAddress: z.string().optional(),
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
    const orders = await ordersService.listOrders({
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
    res.json({ order: await ordersService.getOrderFull(req.params.id) });
  })
);

ordersRouter.post(
  "/",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = createOrderSchema.parse(req.body);
    const order = await ordersService.createOrder(input, req.user!.id, req.user!.role);
    res.status(201).json({ order: await ordersService.getOrderFull(order.id) });
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
    const order = await ordersService.updateOrderItems(req.params.id, { ...input, orderType: "DINE_IN" }, req.user!.id, req.user!.role);
    res.json({ order: await ordersService.getOrderFull(order.id) });
  })
);

const cancelSchema = z.object({ reason: z.string().min(1) });

ordersRouter.post(
  "/:id/cancel",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = cancelSchema.parse(req.body);
    const order = await ordersService.cancelOrder(req.params.id, input.reason, req.user!.id, req.user!.role);
    res.json({ order });
  })
);

const paymentLineSchema = z.object({
  paymentMethodId: z.string(),
  amountPaise: z.number().int().positive(),
  reference: z.string().optional(),
});

const completeSchema = z.object({
  payments: z.array(paymentLineSchema).default([]),
  allowNegativeStock: z.boolean().optional(),
  overrideReason: z.string().optional(),
  bypassMissingInventory: z.boolean().optional(),
});

ordersRouter.post(
  "/:id/complete",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = completeSchema.parse(req.body);
    const { order, stockWarnings } = await ordersService.completeOrder(req.params.id, input, req.user!.id, req.user!.role);
    res.json({ order: await ordersService.getOrderFull(order.id), stockWarnings });
  })
);

const paymentsSchema = z.object({ payments: z.array(paymentLineSchema).min(1) });

// Records payment WITHOUT finishing the order — the COD/rider-collection
// step, or staff logging a phone payment ahead of dispatch. Riders may only
// use this on an order assigned to them (enforced in the service).
ordersRouter.post(
  "/:id/payments",
  requireAuth,
  isAnyRoleOrRider,
  asyncHandler(async (req, res) => {
    const input = paymentsSchema.parse(req.body);
    const order = await ordersService.recordPayment(req.params.id, input.payments, req.user!.id, req.user!.role);
    res.json({ order: await ordersService.getOrderFull(order.id) });
  })
);

const statusSchema = z.object({ status: z.enum(["PREPARING", "READY", "OUT_FOR_DELIVERY"]) });

// Single-step kitchen-advance / "send for delivery" action. Staff-only —
// riders act through /:id/payments and /:id/deliver instead.
ordersRouter.patch(
  "/:id/status",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = statusSchema.parse(req.body);
    const order = await ordersService.updateOrderStatus(req.params.id, input.status, req.user!.id);
    res.json({ order: await ordersService.getOrderFull(order.id) });
  })
);

// The rider's (or staff's) final action on a delivery — blocked server-side
// unless payment_status is already PAID.
const deliverSchema = z.object({ bypassMissingInventory: z.boolean().optional() }).default({});

ordersRouter.post(
  "/:id/deliver",
  requireAuth,
  isAnyRoleOrRider,
  asyncHandler(async (req, res) => {
    const input = deliverSchema.parse(req.body ?? {});
    const { order, stockWarnings } = await ordersService.markDelivered(req.params.id, req.user!.id, req.user!.role, {
      bypassMissingInventory: input.bypassMissingInventory,
    });
    res.json({ order: await ordersService.getOrderFull(order.id), stockWarnings });
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
    const order = await ordersService.refundOrder(req.params.id, input, req.user!.id, req.user!.role);
    res.json({ order });
  })
);

// ============================================================
// Rider delivery flow. Note: these use two-segment paths (/rider/mine,
// /rider/options) so they don't collide with the single-segment GET /:id
// route registered above.
// ============================================================

ordersRouter.get(
  "/rider/mine",
  requireAuth,
  isRider,
  asyncHandler(async (req, res) => {
    const orders = await ordersService.listOrdersForRider(req.user!.id, req.query.all === "1");
    res.json({ orders });
  })
);

ordersRouter.get(
  "/rider/options",
  requireAuth,
  isAnyRole,
  asyncHandler(async (_req, res) => {
    res.json({ riders: await ordersService.listRiders() });
  })
);

const assignRiderSchema = z.object({ riderId: z.string() });

ordersRouter.post(
  "/:id/assign-rider",
  requireAuth,
  isAnyRole,
  asyncHandler(async (req, res) => {
    const input = assignRiderSchema.parse(req.body);
    const order = await ordersService.assignRider(req.params.id, input.riderId, req.user!.id);
    res.json({ order });
  })
);
