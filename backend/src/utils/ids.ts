import { v4 as uuidv4 } from "uuid";

export function newId(prefix?: string): string {
  const id = uuidv4();
  return prefix ? `${prefix}_${id}` : id;
}

export function todayBusinessDate(): string {
  // Business date is a plain calendar date (Asia/Kolkata), not a timestamp.
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}
