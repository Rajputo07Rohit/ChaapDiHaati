import { connectMongo } from "./db/mongoose";
import { app } from "./app";
import { env } from "./config/env";

async function main() {
  await connectMongo();
  app.listen(env.port, () => {
    console.log(`Chaap Di Haati RMS backend listening on port ${env.port} (${env.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
