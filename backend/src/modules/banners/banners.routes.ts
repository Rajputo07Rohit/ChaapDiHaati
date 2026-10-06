import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { ValidationError } from "../../utils/errors";
import { newId } from "../../utils/ids";
import * as bannersService from "./banners.service";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads", "banners");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${newId("banner")}${path.extname(file.originalname).toLowerCase()}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new ValidationError("Only image files are allowed."));
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
    const imageUrl = `/uploads/banners/${req.file.filename}`;
    const banner = await bannersService.createBanner({ imageUrl, title: input.title, linkUrl: input.linkUrl, userId: req.user!.id });
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
