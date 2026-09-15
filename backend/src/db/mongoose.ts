import mongoose from "mongoose";
import { env } from "../config/env";

mongoose.set("strictQuery", true);

export async function connectMongo(): Promise<void> {
  await mongoose.connect(env.mongodbUri);
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
