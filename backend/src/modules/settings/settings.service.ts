import { db } from "../../db/connection";
import { nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";

export function getSetting<T = unknown>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown, userId: string): void {
  const existing = getSetting(key, null);
  db.prepare(
    `INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, JSON.stringify(value), userId, nowIso());

  recordAudit({ userId, action: "SETTING_CHANGED", entityType: "setting", entityId: key, oldValue: existing, newValue: value });
}

export function listSettings() {
  return db.prepare("SELECT * FROM settings").all();
}
