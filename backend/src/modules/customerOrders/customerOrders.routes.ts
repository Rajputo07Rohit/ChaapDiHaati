import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireCustomerAuth } from "../../middleware/customerAuth";
import * as customerOrdersService from "./customerOrders.service";
import { OrderRow } from "../orders/orders.service";

export const customerOrdersRouter = Router();

/**
 * The internal OrderRow carries staff-only data (cogs_paise/margins,
 * created_by, discount_reason, cancel_reason, other customers' phone, …).
 * Customer-facing responses only ever send this trimmed shape — just what
 * the customer app's confirmation screen needs.
 */
function toCustomerOrderResponse(order: OrderRow) {
  return {
    id: order.id,
    order_number: order.order_number,
    order_type: order.order_type,
    status: order.status,
    payment_status: order.payment_status,
    net_total_paise: order.net_total_paise,
    subtotal_paise: order.subtotal_paise,
    delivery_fee_paise: order.delivery_fee_paise,
    notes: null,
    created_at: order.created_at,
  };
}

const orderItemSchema = z.object({
  menuItemId: z.string(),
  priceType: z.enum(["HALF", "FULL", "SINGLE"]),
  quantity: z.number().int().min(1),
  specialInstructions: z.string().optional(),
});

const createOrderSchema = z.object({
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]),
  customerName: z.string().max(100).optional(),
  tableLabel: z.string().optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryLatitude: z.number().min(-90).max(90).optional(),
  deliveryLongitude: z.number().min(-180).max(180).optional(),
  paymentProvider: z.enum(["MOCK", "COD", "RAZORPAY"]).optional(),
  razorpayOrderId: z.string().optional(),
  razorpayPaymentId: z.string().optional(),
  razorpaySignature: z.string().optional(),
  items: z.array(orderItemSchema).min(1),
  notes: z.string().optional(),
  idempotencyKey: z.string().min(1).max(100).optional(),
});

const razorpayOrderSchema = z.object({
  orderType: z.enum(["DINE_IN", "TAKEAWAY", "DELIVERY"]),
  items: z.array(orderItemSchema).min(1),
});

customerOrdersRouter.post(
  "/",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const input = createOrderSchema.parse(req.body);
    const order = await customerOrdersService.createCustomerOrder(input, req.customer!.phone);
    res.status(201).json({ order: toCustomerOrderResponse(order) });
  })
);

customerOrdersRouter.post(
  "/razorpay-order",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const input = razorpayOrderSchema.parse(req.body);
    const result = await customerOrdersService.createRazorpayOrder(input);
    res.status(201).json(result);
  })
);
