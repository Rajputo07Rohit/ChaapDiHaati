import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { Model } from "mongoose";
import * as models from "../../db/models";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { nowIso } from "../../utils/ids";
import { UnauthorizedError, ValidationError } from "../../utils/errors";
import { findUserByUsername } from "../auth/auth.service";

const BACKUP_DIR = path.join(process.cwd(), "backups");

// Every collection in the app, backed up/restored as one JSON file each.
// Order matters for restore: independent/reference collections first,
// dependent ones after (harmless for Mongo since there's no FK enforcement,
// but keeps the backup folder's contents easy to reason about).
const BACKED_UP_MODELS: Model<any>[] = [
  models.User,
  models.PaymentMethod,
  models.Setting,
  models.MenuCategory,
  models.MenuItem,
  models.MenuPrice,
  models.Supplier,
  models.InventoryItem,
  models.InventoryMovement,
  models.WastageRecord,
  models.RecipeVersion,
  models.Order,
  models.Refund,
  models.Purchase,
  models.Expense,
  models.CashTransaction,
  models.BankTransaction,
  models.DailyClosing,
  models.StockCount,
  models.Staff,
  models.AuditLog,
  models.Counter,
  models.HistoricalItemSale,
];

/**
 * MongoDB has no single-file whole-database copy the way SQLite's
 * `db.backup()` did. This instead dumps every collection to its own JSON
 * file in a timestamped folder — an application-level export/import that
 * doesn't need the `mongodump`/`mongorestore` binaries present on the host.
 */
export async function createBackup(userId: string): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const folderName = `backup-${nowIso().replace(/[:.]/g, "-")}`;
  const dest = path.join(BACKUP_DIR, folderName);
  fs.mkdirSync(dest, { recursive: true });

  for (const model of BACKED_UP_MODELS) {
    const docs = await model.find().lean();
    fs.writeFileSync(path.join(dest, `${model.collection.name}.json`), JSON.stringify(docs));
  }

  await recordAudit({ userId, action: "DATABASE_BACKUP_CREATED", entityType: "database", newValue: { folderName } });
  return dest;
}

export function listBackups(): { filename: string; sizeBytes: number; createdAt: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => fs.statSync(path.join(BACKUP_DIR, f)).isDirectory())
    .map((f) => {
      const dir = path.join(BACKUP_DIR, f);
      const stat = fs.statSync(dir);
      const sizeBytes = fs.readdirSync(dir).reduce((sum, file) => sum + fs.statSync(path.join(dir, file)).size, 0);
      return { filename: f, sizeBytes, createdAt: stat.birthtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackupPath(filename: string): string {
  const safe = path.basename(filename);
  const full = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(full)) throw new ValidationError("Backup not found.");
  return full;
}

/** Combines a backup folder's per-collection JSON files into one downloadable JSON document. */
export function readBackupAsSingleFile(filename: string): Record<string, unknown[]> {
  const dir = getBackupPath(filename);
  const combined: Record<string, unknown[]> = {};
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    combined[file.replace(/\.json$/, "")] = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
  }
  return combined;
}

/**
 * Restoring replaces every collection's contents with what's in the backup
 * folder. The caller must confirm the admin's password again (defence
 * against a hijacked session), and a fresh safety backup of the CURRENT
 * state is taken first, so a bad restore is itself reversible. Unlike the
 * old SQLite file-swap, this doesn't need a process restart — Mongo doesn't
 * hold an exclusive file handle the way a single-file SQLite DB did.
 */
export async function restoreBackup(filename: string, adminUsername: string, adminPassword: string, userId: string): Promise<void> {
  const user = await findUserByUsername(adminUsername);
  if (!user || !bcrypt.compareSync(adminPassword, user.password_hash)) {
    throw new UnauthorizedError("Admin password confirmation failed.");
  }

  const backupPath = getBackupPath(filename);
  await createBackup(userId); // safety snapshot of current state before restore

  await withTransaction(async (session) => {
    for (const model of BACKED_UP_MODELS) {
      const filePath = path.join(backupPath, `${model.collection.name}.json`);
      if (!fs.existsSync(filePath)) continue;
      const docs = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      await model.deleteMany({}, { session });
      if (docs.length > 0) await model.insertMany(docs, { session });
    }

    await recordAudit({ userId, action: "DATABASE_RESTORED", entityType: "database", newValue: { filename } }, session);
  });
}
