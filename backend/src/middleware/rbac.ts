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
