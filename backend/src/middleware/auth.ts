import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/errors";
import { db } from "../db/connection";
import { Role } from "../types/express";

interface JwtPayload {
  sub: string;
}

const COOKIE_NAME = "cdh_session";

export function issueTokenCookie(res: Response, userId: string) {
  const token = jwt.sign({ sub: userId } as JwtPayload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000,
  });
}

export function clearTokenCookie(res: Response) {
  res.clearCookie(COOKIE_NAME);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] || bearerToken(req);
  if (!token) return next(new UnauthorizedError());

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    const user = db
      .prepare("SELECT id, username, full_name as fullName, role, active FROM users WHERE id = ?")
      .get(payload.sub) as
      | { id: string; username: string; fullName: string; role: Role; active: number }
      | undefined;

    if (!user || !user.active) return next(new UnauthorizedError("Session is no longer valid."));

    req.user = { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
    next();
  } catch {
    next(new UnauthorizedError("Session expired. Please log in again."));
  }
}

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  return null;
}
