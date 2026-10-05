import mongoose from "mongoose";
import { env } from "../config/env";

mongoose.set("strictQuery", true);

export async function connectMongo(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
  // Mongoose builds indexes in the background by default — awaiting them
  // here closes a real race: e.g. two near-simultaneous customer orders
  // with the same idempotencyKey are only deduped by the unique index on
  // clientIdempotencyKey, and without this, both could insert successfully
  // during the (normally brief, but non-zero) window before that index
  // finishes building, right after a fresh connect/deploy.
  await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()));
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
}

/**
 * Runs `fn` inside a Mongo session/transaction, retrying automatically on
 * transient errors (write conflicts, etc — mirrors the safety SQLite's
 * single-writer model gave every `db.transaction()` call for free).
 */
export async function withTransaction<T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result!;
  } finally {
    await session.endSession();
  }
}
