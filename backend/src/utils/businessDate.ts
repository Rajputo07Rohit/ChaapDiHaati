import { db } from "../db/connection";
import { todayBusinessDate } from "./ids";
import { ForbiddenError, ValidationError } from "./errors";
import { Role } from "../types/express";

export interface ClosingRow {
  id: string;
  business_date: string;
  status: "OPEN" | "CLOSED";
}

export function getClosingByDate(businessDate: string): ClosingRow | undefined {
  return db.prepare("SELECT * FROM daily_closings WHERE business_date = ?").get(businessDate) as
    | ClosingRow
    | undefined;
}

/**
 * Guards every write that carries a business_date. Returns true when the
 * write lands on an already-closed day (so the caller can add an explicit
 * audit note) — only ADMIN may write to a closed day at all.
 */
export function assertBusinessDateWritable(businessDate: string, role: Role): boolean {
  const today = todayBusinessDate();
  if (businessDate > today) {
    throw new ValidationError("Cannot record a transaction dated in the future.");
  }
  const closing = getClosingByDate(businessDate);
  if (closing?.status === "CLOSED") {
    if (role !== "ADMIN") {
      throw new ForbiddenError(
        `${businessDate} is already closed. Only an Admin can modify records on a closed day.`
      );
    }
    return true;
  }
  return false;
}
