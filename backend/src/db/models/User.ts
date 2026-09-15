import { Schema, model } from "mongoose";

export type Role = "ADMIN" | "MANAGER" | "STAFF" | "RIDER";

export interface UserDoc {
  _id: string;
  username: string;
  passwordHash: string;
  fullName: string;
  role: Role;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

const schema = new Schema<UserDoc>({
  _id: { type: String },
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  fullName: { type: String, required: true },
  role: { type: String, required: true, enum: ["ADMIN", "MANAGER", "STAFF", "RIDER"] },
  active: { type: Boolean, required: true, default: true },
  createdAt: { type: String, required: true },
  updatedAt: { type: String, required: true },
});
schema.index({ role: 1 });

export const User = model<UserDoc>("User", schema);
