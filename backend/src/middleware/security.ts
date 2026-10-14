import { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../config/env";

/** Baseline hardening headers for every response (a minimal helmet). */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), payment=()");
  // This server only returns JSON/images — nothing here should ever execute script.
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (env.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/** API responses carry orders, phone numbers and money — never let a browser or proxy cache them. */
export function noStoreApi(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  next();
}

const rateMessage = { error: { message: "Too many attempts. Please try again later.", code: "RATE_LIMITED" } };

/** SMS costs money and OTPs can be brute-forced, so these are far tighter than the general public limit. */
export const otpSendLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: rateMessage });
export const otpVerifyLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: rateMessage });

const COST_FIELDS = ["cogs_paise", "recipe_version_id"];
const RIDER_HIDDEN_FIELDS = [...COST_FIELDS, "created_by", "discount_reason", "discount_type", "discount_value", "item_discount_total_paise"];

function strip(value: unknown, fields: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => strip(v, fields));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!fields.has(k)) out[k] = strip(v, fields);
    }
    return out;
  }
  return value;
}

/**
 * Cost-of-goods and internal bookkeeping fields are for Manager/Admin only.
 * Counter staff and riders can't be trusted with margins — a staff login
 * opening DevTools must not see what an item costs to make. Applied at the
 * response boundary so a field added to a service later can't leak by accident.
 */
export function redactOrderFieldsForRole(req: Request, res: Response, next: NextFunction) {
  const original = res.json.bind(res);
  res.json = (body: unknown) => {
    const role = req.user?.role;
    if (role === "STAFF") return original(strip(body, new Set(COST_FIELDS)));
    if (role === "RIDER") return original(strip(body, new Set(RIDER_HIDDEN_FIELDS)));
    return original(body);
  };
  next();
}
