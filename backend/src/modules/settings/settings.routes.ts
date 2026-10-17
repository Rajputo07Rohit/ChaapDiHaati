import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as settingsService from "./settings.service";

export const settingsRouter = Router();

// The shop's Google Maps location, shown in the customer app footer until the owner changes it in Settings.
const DEFAULT_MAPS_URL = "https://maps.app.goo.gl/VUCj22HZXYZkSA1K6";
// Where "rate us on Google" sends customers — same link printed on bills.
const DEFAULT_REVIEW_URL = "https://maps.app.goo.gl/rTocnqdde3bYs54b9";
const DEFAULT_INSTAGRAM = "desi_chaap_di_hatti_bit";
const DEFAULT_ADDRESS = "BIT Gate, Near Kislay Vidya Mandir, Ranchi, Jharkhand";
const DEFAULT_PHONE = "+91 99020 15719";

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
      address: await settingsService.getSetting("business_address", DEFAULT_ADDRESS),
      phone: await settingsService.getSetting("business_phone", DEFAULT_PHONE),
      instagram: await settingsService.getSetting("business_instagram", DEFAULT_INSTAGRAM),
      mapsUrl: await settingsService.getSetting("business_maps_url", DEFAULT_MAPS_URL),
      reviewUrl: await settingsService.getSetting("business_review_url", DEFAULT_REVIEW_URL),
      // Customer app: "Pure Veg" badge (only shown when the owner turns it on) and the
      // WhatsApp number behind "Need help?" (falls back to the phone number above).
      pureVeg: await settingsService.getSetting("business_pure_veg", false),
      supportWhatsapp: await settingsService.getSetting("business_support_whatsapp", ""),
    });
  })
);

// Shown to customers as clickable links, so only plain https:// URLs (blocks javascript: and similar).
const httpsLink = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || /^https:\/\/[^\s"'<>]+$/i.test(v), "Must be a full https:// link")
  .optional();

const businessProfileSchema = z.object({
  businessName: z.string().min(1),
  tagline: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().max(30).optional(),
  // "@handle", "handle" or an instagram.com link — never an arbitrary URL.
  instagram: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^@?[A-Za-z0-9._]{1,30}$/.test(v) || /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9._]+/i.test(v), "Enter an Instagram @username or profile link")
    .optional(),
  mapsUrl: httpsLink,
  reviewUrl: httpsLink,
  pureVeg: z.boolean().optional(),
  supportWhatsapp: z.string().trim().max(20).regex(/^(\+?\d[\d\s-]{6,16})?$/, "Enter a valid WhatsApp number").optional(),
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
    await settingsService.setSetting("business_phone", input.phone?.trim() ?? "", req.user!.id);
    await settingsService.setSetting("business_instagram", input.instagram?.trim() ?? "", req.user!.id);
    await settingsService.setSetting("business_maps_url", input.mapsUrl?.trim() ?? "", req.user!.id);
    await settingsService.setSetting("business_review_url", input.reviewUrl?.trim() ?? "", req.user!.id);
    if (input.pureVeg !== undefined) await settingsService.setSetting("business_pure_veg", input.pureVeg, req.user!.id);
    if (input.supportWhatsapp !== undefined) await settingsService.setSetting("business_support_whatsapp", input.supportWhatsapp, req.user!.id);
    res.json({ ok: true });
  })
);

/** Public, read-only contact details for the customer app's footer. */
export const publicBusinessRouter = Router();

publicBusinessRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({
      businessName: await settingsService.getSetting("business_name", "Chaap Di Haati"),
      tagline: await settingsService.getSetting("business_tagline", ""),
      address: await settingsService.getSetting("business_address", DEFAULT_ADDRESS),
      phone: await settingsService.getSetting("business_phone", DEFAULT_PHONE),
      instagram: await settingsService.getSetting("business_instagram", DEFAULT_INSTAGRAM),
      mapsUrl: await settingsService.getSetting("business_maps_url", DEFAULT_MAPS_URL),
      reviewUrl: await settingsService.getSetting("business_review_url", DEFAULT_REVIEW_URL),
      // Customer app: "Pure Veg" badge (only shown when the owner turns it on) and the
      // WhatsApp number behind "Need help?" (falls back to the phone number above).
      pureVeg: await settingsService.getSetting("business_pure_veg", false),
      supportWhatsapp: await settingsService.getSetting("business_support_whatsapp", ""),
    });
  })
);
