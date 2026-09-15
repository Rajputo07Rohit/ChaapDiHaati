import { ClientSession } from "mongoose";
import { AuditLog } from "../db/models";
import { newId, nowIso } from "./ids";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

/**
 * Writes an immutable audit trail entry. Pass the same `session` as the
 * mutation it records (when there is one), so the two commit or roll back
 * together and are never inconsistent. `oldValue`/`newValue` are stored as
 * native embedded documents, not JSON strings.
 */
export async function recordAudit(entry: AuditEntry, session?: ClientSession): Promise<void> {
  await AuditLog.create(
    [
      {
        _id: newId("audit"),
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        reason: entry.reason ?? null,
        createdAt: nowIso(),
      },
    ],
    { session }
  );
}
