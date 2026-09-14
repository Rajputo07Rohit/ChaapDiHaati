import { Router } from "express";
import { z } from "zod";
import { db } from "../../db/connection";
import { newId } from "../../utils/ids";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import * as paymentMethodsService from "./paymentMethods.service";

export const paymentMethodsRouter = Router();

paymentMethodsRouter.get("/", requireAuth, (_req, res) => {
  res.json({ methods: paymentMethodsService.listPaymentMethods() });
});

const createSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["CASH", "ONLINE"]),
  sortOrder: z.number().int().default(0),
});

paymentMethodsRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const id = newId("pm");
    db.prepare("INSERT INTO payment_methods (id, name, type, active, sort_order) VALUES (?, ?, ?, 1, ?)").run(
      id,
      input.name,
      input.type,
      input.sortOrder
    );
    res.status(201).json({ method: db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(id) });
  })
);

const updateSchema = z.object({ active: z.boolean().optional(), name: z.string().optional(), sortOrder: z.number().int().optional() });

paymentMethodsRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    db.prepare(
      "UPDATE payment_methods SET active = COALESCE(?, active), name = COALESCE(?, name), sort_order = COALESCE(?, sort_order) WHERE id = ?"
    ).run(input.active === undefined ? null : input.active ? 1 : 0, input.name ?? null, input.sortOrder ?? null, req.params.id);
    res.json({ method: db.prepare("SELECT * FROM payment_methods WHERE id = ?").get(req.params.id) });
  })
);
