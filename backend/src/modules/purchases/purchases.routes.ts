import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import * as purchasesService from "./purchases.service";

export const purchasesRouter = Router();

purchasesRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const purchases = await purchasesService.listPurchases({
      businessDate: req.query.businessDate as string | undefined,
      supplierId: req.query.supplierId as string | undefined,
    });
    res.json({ purchases });
  })
);

purchasesRouter.get(
  "/:id",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const purchase = await purchasesService.getPurchaseOrThrow(req.params.id);
    res.json({ purchase, items: await purchasesService.getPurchaseItems(req.params.id) });
  })
);

const purchaseItemSchema = z.object({
  inventoryItemId: z.string(),
  quantity: z.number().positive(),
  purchaseUnit: z.string().min(1),
  ratePaise: z.number().int().min(0).nullable().optional(),
  pricePending: z.boolean().optional(),
  notes: z.string().optional(),
});

const createPurchaseSchema = z.object({
  supplierId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  businessDate: z.string().optional(),
  paymentMethodId: z.string().optional(),
  paymentStatus: z.enum(["PAID", "CREDIT", "PARTIAL"]),
  amountPaidPaise: z.number().int().min(0).optional(),
  items: z.array(purchaseItemSchema).min(1),
  taxPaise: z.number().int().min(0).optional(),
  discountPaise: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

purchasesRouter.post(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = createPurchaseSchema.parse(req.body);
    const purchase = await purchasesService.recordPurchase(input, req.user!.id, req.user!.role);
    res.status(201).json({ purchase, items: await purchasesService.getPurchaseItems(purchase.id) });
  })
);

const voidSchema = z.object({ reason: z.string().min(1) });

purchasesRouter.post(
  "/:id/void",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = voidSchema.parse(req.body);
    const purchase = await purchasesService.voidPurchase(req.params.id, input.reason, req.user!.id);
    res.json({ purchase });
  })
);
