import { Setting } from "../../db/models";
import { nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";

export async function getSetting<T = unknown>(key: string, fallback: T): Promise<T> {
  const row = await Setting.findById(key);
  if (!row) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: unknown, userId: string): Promise<void> {
  const existing = await getSetting(key, null);
  await Setting.findByIdAndUpdate(key, { value, updatedBy: userId, updatedAt: nowIso() }, { upsert: true });

  await recordAudit({ userId, action: "SETTING_CHANGED", entityType: "setting", entityId: key, oldValue: existing, newValue: value });
}

export async function listSettings() {
  const docs = await Setting.find();
  return docs.map((d) => ({ key: d._id, value: d.value, updated_by: d.updatedBy, updated_at: d.updatedAt }));
}
