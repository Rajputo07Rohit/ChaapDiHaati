import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { issueTokenCookie, clearTokenCookie, requireAuth } from "../../middleware/auth";
import { isAdmin } from "../../middleware/rbac";
import { recordAudit } from "../../utils/audit";
import * as authService from "./auth.service";

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = authService.login(username, password);
    issueTokenCookie(res, user.id);
    recordAudit({ userId: user.id, action: "LOGIN", entityType: "user", entityId: user.id });
    res.json({ user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role } });
  })
);

authRouter.post("/logout", requireAuth, (req, res) => {
  recordAudit({ userId: req.user!.id, action: "LOGOUT", entityType: "user", entityId: req.user!.id });
  clearTokenCookie(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(1),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]),
});

authRouter.get("/users", requireAuth, isAdmin, (_req, res) => {
  res.json({ users: authService.listUsers() });
});

authRouter.post(
  "/users",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = authService.createUser(input, req.user!.id);
    res.status(201).json({ user });
  })
);

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

authRouter.patch(
  "/users/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const user = authService.updateUser(req.params.id, input, req.user!.id);
    res.json({ user });
  })
);
