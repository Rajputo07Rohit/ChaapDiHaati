import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { isAdmin, isManagerUp } from "../../middleware/rbac";
import * as expensesService from "./expenses.service";

export const expensesRouter = Router();

const CATEGORIES = [
  "Milk", "Curd", "Vegetables", "Gas", "Coal", "Electricity", "Repair", "Maintenance",
  "Staff", "Transport", "Cleaning", "Packaging", "Miscellaneous", "Other",
] as const;

expensesRouter.get(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const expenses = await expensesService.listExpenses({
      businessDate: req.query.businessDate as string | undefined,
      from: req.query.from as string | undefined,
      to: req.query.to as string | undefined,
      category: req.query.category as string | undefined,
    });
    res.json({ expenses });
  })
);

const createExpenseSchema = z.object({
  businessDate: z.string().optional(),
  category: z.enum(CATEGORIES),
  description: z.string().min(1),
  amountPaise: z.number().int().positive(),
  paymentMethodId: z.string(),
  vendor: z.string().optional(),
  receiptRef: z.string().optional(),
  notes: z.string().optional(),
});

expensesRouter.post(
  "/",
  requireAuth,
  isManagerUp,
  asyncHandler(async (req, res) => {
    const input = createExpenseSchema.parse(req.body);
    const expense = await expensesService.recordExpense(input, req.user!.id, req.user!.role);
    res.status(201).json({ expense });
  })
);

const voidSchema = z.object({ reason: z.string().min(1) });

expensesRouter.post(
  "/:id/void",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = voidSchema.parse(req.body);
    const expense = await expensesService.voidExpense(req.params.id, input.reason, req.user!.id);
    res.json({ expense });
  })
);
