import { afterAll, beforeAll } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

let replSet: MongoMemoryReplSet;

beforeAll(async () => {
  // Transactions require a real replica set — a single-node one is enough
  // for tests and starts fast.
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replSet.getUri("chaapdihaati_test");
  await mongoose.connect(process.env.MONGODB_URI);
}, 60_000);

afterAll(async () => {
  await mongoose.disconnect();
  await replSet.stop();
});
