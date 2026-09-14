import bcrypt from "bcryptjs";
import { db } from "../../db/connection";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors";
import { env } from "../../config/env";
import { Role } from "../../types/express";

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: Role;
  active: number;
  created_at: string;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
}

export function login(username: string, password: string): UserRow {
  const user = findUserByUsername(username);
  if (!user || !user.active) throw new UnauthorizedError("Invalid username or password.");
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) throw new UnauthorizedError("Invalid username or password.");
  return user;
}

export function listUsers() {
  return db
    .prepare("SELECT id, username, full_name, role, active, created_at FROM users ORDER BY created_at ASC")
    .all();
}

export function createUser(
  input: { username: string; password: string; fullName: string; role: Role },
  adminUserId: string
): UserRow {
  const existing = findUserByUsername(input.username);
  if (existing) throw new ConflictError("A user with this username already exists.");
  if (input.password.length < 6) throw new ValidationError("Password must be at least 6 characters.");

  const id = newId("user");
  const hash = bcrypt.hashSync(input.password, env.bcryptSaltRounds);
  const now = nowIso();

  const txn = db.transaction(() => {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(id, input.username, hash, input.fullName, input.role, now, now);

    recordAudit({
      userId: adminUserId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: id,
      newValue: { username: input.username, role: input.role },
    });
  });
  txn();

  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow;
}

export function updateUser(
  userId: string,
  changes: { fullName?: string; role?: Role; active?: boolean; password?: string },
  adminUserId: string
) {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as UserRow | undefined;
  if (!existing) throw new NotFoundError("User");

  const now = nowIso();
  const txn = db.transaction(() => {
    if (changes.fullName !== undefined) {
      db.prepare("UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?").run(changes.fullName, now, userId);
    }
    if (changes.role !== undefined && changes.role !== existing.role) {
      db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE id = ?").run(changes.role, now, userId);
      recordAudit({
        userId: adminUserId,
        action: "ROLE_CHANGED",
        entityType: "user",
        entityId: userId,
        oldValue: { role: existing.role },
        newValue: { role: changes.role },
      });
    }
    if (changes.active !== undefined) {
      db.prepare("UPDATE users SET active = ?, updated_at = ? WHERE id = ?").run(changes.active ? 1 : 0, now, userId);
      recordAudit({
        userId: adminUserId,
        action: changes.active ? "USER_REACTIVATED" : "USER_DEACTIVATED",
        entityType: "user",
        entityId: userId,
      });
    }
    if (changes.password) {
      if (changes.password.length < 6) throw new ValidationError("Password must be at least 6 characters.");
      const hash = bcrypt.hashSync(changes.password, env.bcryptSaltRounds);
      db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, now, userId);
      recordAudit({ userId: adminUserId, action: "PASSWORD_RESET", entityType: "user", entityId: userId });
    }
  });
  txn();

  return db.prepare("SELECT id, username, full_name, role, active FROM users WHERE id = ?").get(userId);
}
