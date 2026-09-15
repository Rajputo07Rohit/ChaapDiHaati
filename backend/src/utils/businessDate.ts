import { DailyClosing } from "../db/models";
import { todayBusinessDate } from "./ids";
import { ForbiddenError, ValidationError } from "./errors";
import { Role } from "../types/express";

export interface ClosingRow {
  id: string;
  business_date: string;
  status: "OPEN" | "CLOSED";
}

export async function getClosingByDate(businessDate: string): Promise<ClosingRow | undefined> {
  const doc = await DailyClosing.findOne({ businessDate });
  return doc ? { id: doc._id, business_date: doc.businessDate, status: doc.status } : undefined;
}

/**
 * Guards every write that carries a business_date. Returns true when the
 * write lands on an already-closed day (so the caller can add an explicit
 * audit note) — only ADMIN may write to a closed day at all.
 */
export async function assertBusinessDateWritable(businessDate: string, role: Role): Promise<boolean> {
  const today = todayBusinessDate();
  if (businessDate > today) {
    throw new ValidationError("Cannot record a transaction dated in the future.");
  }
  const closing = await getClosingByDate(businessDate);
  if (closing?.status === "CLOSED") {
    if (role !== "ADMIN") {
      throw new ForbiddenError(`${businessDate} is already closed. Only an Admin can modify records on a closed day.`);
    }
    return true;
  }
  return false;
}
