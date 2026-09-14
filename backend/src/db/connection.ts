import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { env } from "../config/env";

const dir = path.dirname(env.databasePath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(env.databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

export function withTransaction<T>(fn: () => T): T {
  const txn = db.transaction(fn);
  return txn();
}
