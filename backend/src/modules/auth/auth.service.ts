import bcrypt from "bcryptjs";
import { User, UserDoc, LoginEvent, Session } from "../../db/models";
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
  is_super_admin: boolean;
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
    is_super_admin: doc.isSuperAdmin,
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

/** Historical record for the Login Activity screen — never modified or
 * deleted, unlike Session below. */
export async function recordLoginEvent(userId: string, ip: string | null, userAgent: string | null): Promise<void> {
  await LoginEvent.create({ _id: newId("logev"), userId, ip, userAgent, createdAt: nowIso() });
}

const MAX_CONCURRENT_SESSIONS: Partial<Record<Role, number>> = {
  ADMIN: 2,
  MANAGER: 1,
  // STAFF/RIDER: unlimited devices — still tracked and visible in Login
  // Activity (device count per account, and the full login history), just
  // never auto-evicted.
};

/**
 * Creates the new session for this login, first evicting the oldest
 * still-active session(s) if this account is already at its per-role
 * device cap — a new legitimate login always succeeds; it's the oldest
 * device that gets silently logged out (its next request fails
 * requireAuth's session check) rather than blocking the person logging in
 * right now.
 */
export async function createSessionWithDeviceLimit(
  userId: string,
  role: Role,
  ip: string | null,
  userAgent: string | null
): Promise<string> {
  const cap = MAX_CONCURRENT_SESSIONS[role];
  if (cap !== undefined) {
    const active = await Session.find({ userId, active: true }).sort({ createdAt: 1 });
    if (active.length >= cap) {
      const toEvict = active.slice(0, active.length - cap + 1);
      const now = nowIso();
      await Session.updateMany(
        { _id: { $in: toEvict.map((s) => s._id) } },
        { $set: { active: false, revokedAt: now } }
      );
    }
  }

  const sessionId = newId("sess");
  await Session.create({ _id: sessionId, userId, ip, userAgent, active: true, createdAt: nowIso(), revokedAt: null });
  return sessionId;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await Session.updateOne({ _id: sessionId }, { $set: { active: false, revokedAt: nowIso() } });
}

/** Force-logout every device an account is currently signed in on — each
 * revoked session's next request fails requireAuth's session check, same
 * as the automatic per-role device-cap eviction. */
export async function revokeAllSessions(userId: string): Promise<number> {
  const res = await Session.updateMany({ userId, active: true }, { $set: { active: false, revokedAt: nowIso() } });
  return res.modifiedCount;
}

/** Force-logout every device on every account, all at once. */
export async function revokeAllSessionsEverywhere(): Promise<number> {
  const res = await Session.updateMany({ active: true }, { $set: { active: false, revokedAt: nowIso() } });
  return res.modifiedCount;
}

export async function listLoginEvents(limit = 300) {
  const events = await LoginEvent.find().sort({ createdAt: -1 }).limit(limit);
  const userIds = [...new Set(events.map((e) => e.userId))];
  const users = await User.find({ _id: { $in: userIds } });
  const byId = new Map(users.map((u) => [u._id, u]));
  return events.map((e) => ({
    id: e._id,
    username: byId.get(e.userId)?.username,
    full_name: byId.get(e.userId)?.fullName,
    role: byId.get(e.userId)?.role,
    ip: e.ip,
    user_agent: e.userAgent,
    created_at: e.createdAt,
  }));
}

/** How many devices each account is CURRENTLY logged into (active
 * sessions right now), not a historical count — this is what the per-role
 * device cap (Admin: 2, Manager: 1) is actually enforcing against. */
export async function listActiveSessionCounts() {
  const active = await Session.find({ active: true });
  const countByUser = new Map<string, number>();
  for (const s of active) countByUser.set(s.userId, (countByUser.get(s.userId) ?? 0) + 1);

  const users = await User.find({ _id: { $in: [...countByUser.keys()] } });
  const byId = new Map(users.map((u) => [u._id, u]));

  return [...countByUser.entries()]
    .map(([userId, count]) => ({
      user_id: userId,
      username: byId.get(userId)?.username,
      full_name: byId.get(userId)?.fullName,
      role: byId.get(userId)?.role,
      active_devices: count,
    }))
    .sort((a, b) => b.active_devices - a.active_devices);
}

export async function listUsers() {
  // isSuperAdmin accounts are deliberately invisible here — the whole point
  // is that the Staff/Users screen (and every regular admin who can open
  // it) never even knows this account exists.
  const docs = await User.find({ isSuperAdmin: { $ne: true } }).sort({ createdAt: 1 });
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
  // Stays fully invisible to the regular Staff/Users management flow —
  // reports "not found" rather than "forbidden" so its existence isn't
  // even hinted at, unless a super admin is editing their own account.
  if (!existing || (existing.isSuperAdmin && userId !== adminUserId)) throw new NotFoundError("User");
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
