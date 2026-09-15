import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as settingsService from "./settings.service";

export const settingsRouter = Router();

settingsRouter.get(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ settings: await settingsService.listSettings() });
  })
);

const setSchema = z.object({ key: z.string().min(1), value: z.any() });

settingsRouter.put(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = setSchema.parse(req.body);
    await settingsService.setSetting(input.key, input.value, req.user!.id);
    res.json({ ok: true });
  })
);

/** Readable by every role (Staff/Manager need it to print/share bills), editable by Admin only. */
settingsRouter.get(
  "/business-profile",
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      businessName: await settingsService.getSetting("business_name", "Chaap Di Haati"),
      tagline: await settingsService.getSetting("business_tagline", ""),
      address: await settingsService.getSetting("business_address", ""),
    });
  })
);

const businessProfileSchema = z.object({
  businessName: z.string().min(1),
  tagline: z.string().optional(),
  address: z.string().optional(),
});

settingsRouter.put(
  "/business-profile",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = businessProfileSchema.parse(req.body);
    await settingsService.setSetting("business_name", input.businessName, req.user!.id);
    await settingsService.setSetting("business_tagline", input.tagline ?? "", req.user!.id);
    await settingsService.setSetting("business_address", input.address ?? "", req.user!.id);
    res.json({ ok: true });
  })
);
