import { NextFunction, Request, Response } from "express";
import { ForbiddenError, UnauthorizedError } from "../utils/errors";
import { Role } from "../types/express";

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError());
    if (!roles.includes(req.user.role)) {
      return next(
        new ForbiddenError(`This action requires ${roles.join(" or ")} access.`)
      );
    }
    next();
  };
}

export const isAdmin = requireRole("ADMIN");
export const isManagerUp = requireRole("ADMIN", "MANAGER");
export const isAnyRole = requireRole("ADMIN", "MANAGER", "STAFF");
export const isRider = requireRole("RIDER");
export const isAnyRoleOrRider = requireRole("ADMIN", "MANAGER", "STAFF", "RIDER");

/** Separate from role entirely — an ADMIN account is not automatically a
 * super admin. Gates Login Activity, which is deliberately invisible to
 * every other account including regular admins. */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new UnauthorizedError());
  if (!req.user.isSuperAdmin) return next(new ForbiddenError());
  next();
}
