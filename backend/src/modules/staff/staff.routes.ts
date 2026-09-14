import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import * as staffService from "./staff.service";

export const staffRouter = Router();

staffRouter.get("/", requireAuth, isManagerUp, (_req, res) => {
  res.json({ staff: staffService.listStaff(), monthlySalaryTotalPaise: staffService.monthlySalaryTotal() });
});

const staffSchema = z.object({
  fullName: z.string().min(1),
  roleTitle: z.string().min(1),
  salaryPaise: z.number().int().min(0),
  salaryMethod: z.enum(["CALENDAR_DAY", "FIXED_30", "WORKING_26", "CUSTOM"]),
  customDays: z.number().int().positive().optional(),
  joiningDate: z.string(),
  phone: z.string().optional(),
});

staffRouter.post(
  "/",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = staffSchema.parse(req.body);
    const staff = staffService.createStaff(input, req.user!.id);
    res.status(201).json({ staff });
  })
);

const updateSchema = staffSchema.partial().extend({ active: z.boolean().optional() });

staffRouter.patch(
  "/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const staff = staffService.updateStaff(req.params.id, input, req.user!.id);
    res.json({ staff });
  })
);
