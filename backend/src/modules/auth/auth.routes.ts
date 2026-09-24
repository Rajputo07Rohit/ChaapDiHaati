import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { issueTokenCookie, clearTokenCookie, requireAuth } from "../../middleware/auth";
import { isAdmin, requireSuperAdmin } from "../../middleware/rbac";
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
    const user = await authService.login(username, password);
    const ip = req.ip ?? null;
    const userAgent = (req.headers["user-agent"] as string | undefined) ?? null;

    // Enforces the per-role concurrent-device cap (Admin: 2, Manager: 1) —
    // evicts the oldest active session first if already at the limit, so
    // this login always succeeds.
    const sessionId = await authService.createSessionWithDeviceLimit(user.id, user.role, ip, userAgent);
    issueTokenCookie(res, user.id, sessionId);

    // Deliberately does NOT include IP/device details — this general audit
    // entry is visible to any ADMIN via /audit-logs. That info is recorded
    // separately (recordLoginEvent) and only reachable through the
    // super-admin-only /login-activity route.
    await recordAudit({ userId: user.id, action: "LOGIN", entityType: "user", entityId: user.id });
    await authService.recordLoginEvent(user.id, ip, userAgent);
    res.json({ user: { id: user.id, username: user.username, fullName: user.full_name, role: user.role, isSuperAdmin: user.is_super_admin } });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.sessionId) await authService.revokeSession(req.sessionId);
    await recordAudit({ userId: req.user!.id, action: "LOGOUT", entityType: "user", entityId: req.user!.id });
    clearTokenCookie(res);
    res.json({ ok: true });
  })
);

authRouter.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Deliberately its own route (not the general /audit-logs, which any
// ADMIN can already reach) so this is truly invisible to every account
// except the one flagged isSuperAdmin.
authRouter.get(
  "/login-activity",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const [rows, activeDevices] = await Promise.all([authService.listLoginEvents(), authService.listActiveSessionCounts()]);
    res.json({ rows, activeDevices });
  })
);

authRouter.post(
  "/users/:id/logout-all",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const count = await authService.revokeAllSessions(req.params.id);
    res.json({ revoked: count });
  })
);

authRouter.post(
  "/logout-all-accounts",
  requireAuth,
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const count = await authService.revokeAllSessionsEverywhere();
    res.json({ revoked: count });
  })
);

const createUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  fullName: z.string().min(1),
  role: z.enum(["ADMIN", "MANAGER", "STAFF", "RIDER"]),
});

authRouter.get(
  "/users",
  requireAuth,
  isAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ users: await authService.listUsers() });
  })
);

authRouter.post(
  "/users",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await authService.createUser(input, req.user!.id);
    res.status(201).json({ user });
  })
);

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "STAFF", "RIDER"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

authRouter.patch(
  "/users/:id",
  requireAuth,
  isAdmin,
  asyncHandler(async (req, res) => {
    const input = updateUserSchema.parse(req.body);
    const user = await authService.updateUser(req.params.id, input, req.user!.id);
    res.json({ user });
  })
);
