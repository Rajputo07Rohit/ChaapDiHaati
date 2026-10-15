import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { ValidationError } from "../../utils/errors";
import { BannerImage } from "../../db/models";
import * as bannersService from "./banners.service";

const storage = multer.memoryStorage();
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    // Raster images only: an SVG (or anything else) could carry script and is
    // served from the app's own origin.
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) return cb(new ValidationError("Only JPG, PNG, WebP or GIF images are allowed."));
    cb(null, true);
  },
});

export const bannersAdminRouter = Router();

bannersAdminRouter.get(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ banners: await bannersService.listBanners() });
  })
);

bannersAdminRouter.post(
  "/",
  requireAuth,
  isAdmin,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("An image file is required.");
    const bodySchema = z.object({ title: z.string().optional(), linkUrl: z.string().optional() });
    const input = bodySchema.parse(req.body);
    const banner = await bannersService.createBanner({
      image: { contentType: req.file.mimetype, data: req.file.buffer },
      title: input.title,
      linkUrl: input.linkUrl,
      userId: req.user!.id,
    });
    res.status(201).json({ banner });
  })
);

const setActiveSchema = z.object({ active: z.boolean().optional(), sortOrder: z.number().int().min(0).optional() });

bannersAdminRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = setActiveSchema.parse(req.body);
    if (input.active !== undefined) await bannersService.setBannerActive(req.params.id, input.active);
    if (input.sortOrder !== undefined) await bannersService.reorderBanner(req.params.id, input.sortOrder);
    const banner = (await bannersService.listBanners()).find((b) => b.id === req.params.id);
    res.json({ banner });
  })
);

bannersAdminRouter.delete(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    await bannersService.deleteBanner(req.params.id);
    res.status(204).send();
  })
);

// ============================================================
// Customer-facing: the carousel on the menu screen.
// ============================================================

export const bannersPublicRouter = Router();

bannersPublicRouter.get(
  "/active",
  asyncHandler(async (_req, res) => {
    res.json({ banners: await bannersService.listActiveBannersForCustomer() });
  })
);

// Public on purpose: it's just the banner picture, referenced by <img src>.
bannersPublicRouter.get(
  "/image/:id",
  asyncHandler(async (req, res) => {
    const img = await BannerImage.findById(req.params.id);
    if (!img) return res.status(404).end();
    res.set("Content-Type", ALLOWED_IMAGE_TYPES.has(img.contentType) ? img.contentType : "application/octet-stream");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Content-Security-Policy", "default-src 'none'; sandbox");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(img.data);
  })
);
