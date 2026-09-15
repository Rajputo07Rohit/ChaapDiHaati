import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import * as suppliersService from "./suppliers.service";

export const suppliersRouter = Router();

suppliersRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (_req, res) => {
    res.json({ suppliers: await suppliersService.listSuppliers() });
  })
);

const createSupplierSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

suppliersRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createSupplierSchema.parse(req.body);
    const supplier = await suppliersService.createSupplier(input);
    res.status(201).json({ supplier });
  })
);
