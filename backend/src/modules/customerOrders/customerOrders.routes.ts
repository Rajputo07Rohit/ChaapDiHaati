import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireCustomerAuth } from "../../middleware/customerAuth";
import * as customerOrdersService from "./customerOrders.service";

export const customerOrdersRouter = Router();

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
    res.status(201).json({ order });
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
