import { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../utils/errors";
import { verifyCustomerToken } from "../modules/customerAuth/customerAuth.service";

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

export function requireCustomerAuth(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) return next(new UnauthorizedError("Please verify your phone number to continue."));

  try {
    const phone = verifyCustomerToken(token);
    req.customer = { phone };
    next();
  } catch {
    next(new UnauthorizedError("Could not verify your phone number. Please sign in again."));
  }
}
