import { Router } from "express";
import path from "path";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as backupService from "./backup.service";

export const backupRouter = Router();

backupRouter.get("/", requireAuth, isAdmin, (_req, res) => {
  res.json({ backups: backupService.listBackups() });
});

backupRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const filePath = await backupService.createBackup(req.user!.id);
    res.status(201).json({ filename: path.basename(filePath) });
  })
);

backupRouter.get(
  "/:filename/download",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const filePath = backupService.getBackupPath(req.params.filename);
    res.download(filePath);
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
    res.json({ ok: true, message: "Database restored. The server is restarting — please refresh in a few seconds." });
  })
);
