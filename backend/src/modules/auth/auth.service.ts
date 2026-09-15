import bcrypt from "bcryptjs";
import { User, UserDoc } from "../../db/models";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from "../../utils/errors";
import { env } from "../../config/env";
import { Role } from "../../types/express";

// Row shape mirrors the old SQL column names exactly — the frontend already
// consumes these field names and needs no changes.
export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  full_name: string;
  role: Role;
  active: boolean;
  created_at: string;
}

function toRow(doc: UserDoc): UserRow {
  return {
    id: doc._id,
    username: doc.username,
    password_hash: doc.passwordHash,
    full_name: doc.fullName,
    role: doc.role,
    active: doc.active,
    created_at: doc.createdAt,
  };
}

export async function findUserByUsername(username: string): Promise<UserRow | undefined> {
  const doc = await User.findOne({ username });
  return doc ? toRow(doc) : undefined;
}

export async function login(username: string, password: string): Promise<UserRow> {
  const user = await findUserByUsername(username);
  if (!user || !user.active) throw new UnauthorizedError("Invalid username or password.");
  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) throw new UnauthorizedError("Invalid username or password.");
  return user;
}

export async function listUsers() {
  const docs = await User.find().sort({ createdAt: 1 });
  return docs.map((d) => ({ id: d._id, username: d.username, full_name: d.fullName, role: d.role, active: d.active, created_at: d.createdAt }));
}

export async function createUser(input: { username: string; password: string; fullName: string; role: Role }, adminUserId: string): Promise<UserRow> {
  const existing = await findUserByUsername(input.username);
  if (existing) throw new ConflictError("A user with this username already exists.");
  if (input.password.length < 6) throw new ValidationError("Password must be at least 6 characters.");

  const id = newId("user");
  const hash = bcrypt.hashSync(input.password, env.bcryptSaltRounds);
  const now = nowIso();

  await withTransaction(async (session) => {
    await User.create(
      [
        {
          _id: id,
          username: input.username,
          passwordHash: hash,
          fullName: input.fullName,
          role: input.role,
          active: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
      { session }
    );

    await recordAudit(
      {
        userId: adminUserId,
        action: "USER_CREATED",
        entityType: "user",
        entityId: id,
        newValue: { username: input.username, role: input.role },
      },
      session
    );
  });

  const created = await User.findById(id);
  return toRow(created!);
}

export async function updateUser(
  userId: string,
  changes: { fullName?: string; role?: Role; active?: boolean; password?: string },
  adminUserId: string
) {
  const existing = await User.findById(userId);
  if (!existing) throw new NotFoundError("User");
  if (changes.password && changes.password.length < 6) throw new ValidationError("Password must be at least 6 characters.");

  const now = nowIso();

  await withTransaction(async (session) => {
    if (changes.fullName !== undefined) {
      existing.fullName = changes.fullName;
    }
    if (changes.role !== undefined && changes.role !== existing.role) {
      const oldRole = existing.role;
      existing.role = changes.role;
      await recordAudit(
        { userId: adminUserId, action: "ROLE_CHANGED", entityType: "user", entityId: userId, oldValue: { role: oldRole }, newValue: { role: changes.role } },
        session
      );
    }
    if (changes.active !== undefined) {
      existing.active = changes.active;
      await recordAudit(
        { userId: adminUserId, action: changes.active ? "USER_REACTIVATED" : "USER_DEACTIVATED", entityType: "user", entityId: userId },
        session
      );
    }
    if (changes.password) {
      existing.passwordHash = bcrypt.hashSync(changes.password, env.bcryptSaltRounds);
      await recordAudit({ userId: adminUserId, action: "PASSWORD_RESET", entityType: "user", entityId: userId }, session);
    }
    existing.updatedAt = now;
    await existing.save({ session });
  });

  return { id: existing._id, username: existing.username, full_name: existing.fullName, role: existing.role, active: existing.active };
}
