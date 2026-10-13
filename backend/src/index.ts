import { connectMongo } from "./db/mongoose";
import { app } from "./app";
import { env } from "./config/env";
import { expireStalePendingOrders } from "./modules/orders/orders.service";

const PENDING_ORDER_TIMEOUT_MINUTES = 5;

async function main() {
  await connectMongo();
  setInterval(() => {
    expireStalePendingOrders(PENDING_ORDER_TIMEOUT_MINUTES).catch((err) => console.error("Pending-order expiry failed:", err));
  }, 30_000);
  app.listen(env.port, () => {
    console.log(`Chaap Di Haati RMS backend listening on port ${env.port} (${env.nodeEnv})`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
