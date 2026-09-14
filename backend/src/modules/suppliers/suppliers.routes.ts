import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";

export const suppliersRouter = Router();

suppliersRouter.get("/", requireAuth, isManagerUp, (_req, res) => {
  res.json({ suppliers: db.prepare("SELECT * FROM suppliers WHERE active = 1 ORDER BY name").all() });
});

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
    const id = newId("sup");
    db.prepare("INSERT INTO suppliers (id, name, phone, address, notes, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)").run(
      id,
      input.name,
      input.phone ?? null,
      input.address ?? null,
      input.notes ?? null,
      nowIso()
    );
    res.status(201).json({ supplier: db.prepare("SELECT * FROM suppliers WHERE id = ?").get(id) });
  })
);
