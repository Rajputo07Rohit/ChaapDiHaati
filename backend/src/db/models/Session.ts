import { Schema, model } from "mongoose";

/**
 * A live, revocable login session — separate from LoginEvent (which is an
 * immutable historical record for the Login Activity screen). This is what
 * actually gates whether a JWT is still valid, and is how the per-role
 * concurrent-device cap is enforced: logging in past the cap revokes the
 * oldest still-active session instead of blocking the new login.
 */
export interface SessionDoc {
  _id: string;
  userId: string;
  ip: string | null;
  userAgent: string | null;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

const schema = new Schema<SessionDoc>({
  _id: { type: String },
  userId: { type: String, required: true, ref: "User" },
  ip: { type: String, default: null },
  userAgent: { type: String, default: null },
  active: { type: Boolean, required: true, default: true },
  createdAt: { type: String, required: true },
  revokedAt: { type: String, default: null },
});
schema.index({ userId: 1, active: 1, createdAt: 1 });

export const Session = model<SessionDoc>("Session", schema);
