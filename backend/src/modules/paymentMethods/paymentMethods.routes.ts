import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as paymentMethodsService from "./paymentMethods.service";

export const paymentMethodsRouter = Router();

paymentMethodsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ methods: await paymentMethodsService.listPaymentMethods() });
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["CASH", "ONLINE"]),
  sortOrder: z.number().int().default(0),
});

paymentMethodsRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const method = await paymentMethodsService.createPaymentMethod(input);
    res.status(201).json({ method });
  })
);

const updateSchema = z.object({ active: z.boolean().optional(), name: z.string().optional(), sortOrder: z.number().int().optional() });

paymentMethodsRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const method = await paymentMethodsService.updatePaymentMethod(req.params.id, input);
    res.json({ method });
  })
);
