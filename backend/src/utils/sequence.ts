import { ClientSession } from "mongoose";
import { Counter } from "../db/models";

const START_VALUES: Record<string, number> = {
  order_number: 1001,
  purchase_number: 1,
};

/**
 * Atomic counter — two operations, both individually atomic:
 * (1) upsert-if-missing seeds the counter at its start value (a no-op if it
 * already exists, and safe under concurrent callers since `$setOnInsert`
 * only ever fires for whichever single insert wins), then (2) `$inc`
 * unconditionally. Can't combine into one `findOneAndUpdate` because Mongo
 * rejects `$inc` and `$setOnInsert` on the same field in one update.
 */
export async function nextSequence(name: string, session?: ClientSession): Promise<number> {
  const start = START_VALUES[name] ?? 1;
  await Counter.updateOne({ _id: name }, { $setOnInsert: { nextValue: start - 1 } }, { upsert: true, session });
  const updated = await Counter.findOneAndUpdate({ _id: name }, { $inc: { nextValue: 1 } }, { returnDocument: "after", session });
  return updated!.nextValue;
}

export async function nextPurchaseNumber(session?: ClientSession): Promise<string> {
  const n = await nextSequence("purchase_number", session);
  return `PO-${String(n).padStart(5, "0")}`;
}
