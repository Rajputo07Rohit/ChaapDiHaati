import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { UnauthorizedError } from "../utils/errors";
import { User, Session } from "../db/models";

interface JwtPayload {
  sub: string;
  sid: string;
}

const COOKIE_NAME = "cdh_session";

export function issueTokenCookie(res: Response, userId: string, sessionId: string) {
  const token = jwt.sign({ sub: userId, sid: sessionId } as JwtPayload, env.jwtSecret, {
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

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE_NAME] || bearerToken(req);
  if (!token) return next(new UnauthorizedError());

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    const user = await User.findById(payload.sub);
    if (!user || !user.active) return next(new UnauthorizedError("Session is no longer valid."));

    // A session gets marked inactive when it's evicted by the per-role
    // concurrent-device cap (see login route) — a still-valid JWT for a
    // revoked session must stop working immediately, not just expire on
    // its own schedule.
    if (payload.sid) {
      const session = await Session.findById(payload.sid);
      if (!session || !session.active) return next(new UnauthorizedError("You've been logged out on this device."));
    }

    req.user = { id: user._id, username: user.username, fullName: user.fullName, role: user.role, isSuperAdmin: !!user.isSuperAdmin };
    req.sessionId = payload.sid;
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
