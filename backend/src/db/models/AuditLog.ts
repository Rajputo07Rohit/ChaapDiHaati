import { Schema, model } from "mongoose";

export interface AuditLogDoc {
  _id: string;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
  createdAt: string;
}

const schema = new Schema<AuditLogDoc>({
  _id: { type: String },
  userId: { type: String, default: null, ref: "User" },
  action: { type: String, required: true },
  entityType: { type: String, required: true },
  entityId: { type: String, default: null },
  oldValue: { type: Schema.Types.Mixed, default: null },
  newValue: { type: Schema.Types.Mixed, default: null },
  reason: { type: String, default: null },
  createdAt: { type: String, required: true },
});
schema.index({ entityType: 1, entityId: 1 });
schema.index({ userId: 1 });
schema.index({ createdAt: -1 });

export const AuditLog = model<AuditLogDoc>("AuditLog", schema);
