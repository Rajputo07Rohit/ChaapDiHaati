import mongoose from "mongoose";
import { connectMongo } from "./mongoose";

async function main() {
  await connectMongo();
  const collections = await mongoose.connection.db!.collections();
  for (const collection of collections) {
    await collection.deleteMany({});
  }
  console.log(`Dropped all documents from ${collections.length} collection(s). Run \`npm run seed\` to rebuild.`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
