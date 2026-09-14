import { db } from "../db/connection";
import { newId } from "./ids";

export interface AuditEntry {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

const insertAudit = db.prepare(`
  INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, reason)
  VALUES (@id, @userId, @action, @entityType, @entityId, @oldValue, @newValue, @reason)
`);

/**
 * Writes an immutable audit trail entry. Call this inside the same DB
 * transaction as the mutation it records, so the two are never inconsistent.
 */
export function recordAudit(entry: AuditEntry): void {
  insertAudit.run({
    id: newId("audit"),
    userId: entry.userId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    oldValue: entry.oldValue !== undefined ? JSON.stringify(entry.oldValue) : null,
    newValue: entry.newValue !== undefined ? JSON.stringify(entry.newValue) : null,
    reason: entry.reason ?? null,
  });
}
