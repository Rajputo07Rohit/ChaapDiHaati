import { Schema, model } from "mongoose";

/**
 * Device/IP details for a successful login — deliberately separate from
 * AuditLog (which any ADMIN can already read via /audit-logs) so this stays
 * reachable only through the super-admin-gated /auth/login-activity route.
 */
export interface LoginEventDoc {
  _id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

const schema = new Schema<LoginEventDoc>({
  _id: { type: String },
  userId: { type: String, required: true, ref: "User" },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  createdAt: { type: String, required: true },
});
schema.index({ userId: 1, createdAt: -1 });
schema.index({ createdAt: -1 });

export const LoginEvent = model<LoginEventDoc>("LoginEvent", schema);
