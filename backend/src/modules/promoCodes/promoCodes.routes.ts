import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { requireCustomerAuth } from "../../middleware/customerAuth";
import * as promoCodesService from "./promoCodes.service";

export const promoCodesAdminRouter = Router();

const createSchema = z.object({
  code: z.string().min(2).max(30),
  description: z.string().min(1).max(200),
  discountType: z.enum(["FLAT", "PERCENTAGE"]),
  discountValue: z.number().positive(),
  minOrderPaise: z.number().int().min(0).optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perCustomerLimit: z.number().int().positive().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
});

promoCodesAdminRouter.get(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ codes: await promoCodesService.listPromoCodes() });
  })
);

promoCodesAdminRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const code = await promoCodesService.createPromoCode({ ...input, userId: req.user!.id });
    res.status(201).json({ code });
  })
);

const setActiveSchema = z.object({ active: z.boolean() });

promoCodesAdminRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = setActiveSchema.parse(req.body);
    const code = await promoCodesService.setPromoCodeActive(req.params.id, input.active);
    res.json({ code });
  })
);

// ============================================================
// Customer-facing: viewing the offers banner and validating a code at
// checkout before it's actually redeemed by placing the order.
// ============================================================

export const promoCodesPublicRouter = Router();

promoCodesPublicRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    res.json({ codes: await promoCodesService.listActivePromoCodesForCustomer() });
  })
);

const validateSchema = z.object({ code: z.string().min(1), subtotalPaise: z.number().int().positive() });

promoCodesPublicRouter.post(
  "/validate",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const input = validateSchema.parse(req.body);
    const promo = await promoCodesService.validatePromoCodeForOrder(input.code, req.customer!.phone, input.subtotalPaise);
    const discountPaise =
      promo.discountType === "PERCENTAGE" ? Math.round((input.subtotalPaise * promo.discountValue) / 100) : Math.min(promo.discountValue, input.subtotalPaise);
    res.json({
      code: promo.code,
      description: promo.description,
      discount_type: promo.discountType,
      discount_value: promo.discountValue,
      discount_paise: discountPaise,
    });
  })
);
