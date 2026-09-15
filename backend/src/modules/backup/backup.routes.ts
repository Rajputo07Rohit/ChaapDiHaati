import { Router } from "express";
import path from "path";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as backupService from "./backup.service";

export const backupRouter = Router();

backupRouter.get(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ backups: backupService.listBackups() });
  })
);

backupRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const folderPath = await backupService.createBackup(req.user!.id);
    res.status(201).json({ filename: path.basename(folderPath) });
  })
);

backupRouter.get(
  "/:filename/download",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const combined = backupService.readBackupAsSingleFile(req.params.filename);
    res.setHeader("Content-Disposition", `attachment; filename="${path.basename(req.params.filename)}.json"`);
    res.json(combined);
  })
);

const restoreSchema = z.object({
  filename: z.string().min(1),
  adminUsername: z.string().min(1),
  adminPassword: z.string().min(1),
});

backupRouter.post(
  "/restore",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = restoreSchema.parse(req.body);
    await backupService.restoreBackup(input.filename, input.adminUsername, input.adminPassword, req.user!.id);
    res.json({ ok: true, message: "Database restored." });
  })
);
