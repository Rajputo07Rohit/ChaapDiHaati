import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import { db } from "../../db/connection";
import { env } from "../../config/env";
import { recordAudit } from "../../utils/audit";
import { nowIso } from "../../utils/ids";
import { UnauthorizedError, ValidationError } from "../../utils/errors";
import { findUserByUsername } from "../auth/auth.service";

const BACKUP_DIR = path.join(path.dirname(env.databasePath), "backups");

export async function createBackup(userId: string): Promise<string> {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const filename = `backup-${nowIso().replace(/[:.]/g, "-")}.db`;
  const dest = path.join(BACKUP_DIR, filename);
  await db.backup(dest);
  recordAudit({ userId, action: "DATABASE_BACKUP_CREATED", entityType: "database", newValue: { filename } });
  return dest;
}

export function listBackups(): { filename: string; sizeBytes: number; createdAt: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { filename: f, sizeBytes: stat.size, createdAt: stat.birthtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackupPath(filename: string): string {
  const safe = path.basename(filename);
  const full = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(full)) throw new ValidationError("Backup file not found.");
  return full;
}

/**
 * Restoring overwrites the live database file. The caller must confirm the
 * admin's password again (defence against a hijacked session) and a fresh
 * safety backup of the CURRENT state is taken first, so a bad restore is
 * itself reversible.
 */
export async function restoreBackup(filename: string, adminUsername: string, adminPassword: string, userId: string): Promise<void> {
  const user = findUserByUsername(adminUsername);
  if (!user || !bcrypt.compareSync(adminPassword, user.password_hash)) {
    throw new UnauthorizedError("Admin password confirmation failed.");
  }

  const backupPath = getBackupPath(filename);
  await createBackup(userId); // safety snapshot of current state before restore

  recordAudit({ userId, action: "DATABASE_RESTORED", entityType: "database", newValue: { filename } });

  // The live connection stays open for the rest of this process, so a clean
  // restore requires a process restart. We copy the file now and exit
  // shortly after responding to the request; a process manager (or `npm run
  // dev`'s watcher) must bring the server back up against the restored file.
  fs.copyFileSync(backupPath, env.databasePath);
  setTimeout(() => process.exit(0), 500);
}
