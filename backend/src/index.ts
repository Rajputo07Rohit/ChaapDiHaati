import { connectMongo } from "./db/mongoose";
import { app } from "./app";
import { env } from "./config/env";
import { expireStalePendingOrders } from "./modules/orders/orders.service";
import { syncGatewayRefunds } from "./modules/payments/refunds.service";
import { reconcileStaleCheckouts } from "./modules/customerOrders/customerOrders.service";
import { reportError } from "./utils/monitoring";

const PENDING_ORDER_TIMEOUT_MINUTES = 5;

/** Runs `job` every `ms`, never overlapping itself (a slow gateway can't pile runs up). */
function every(ms: number, name: string, job: () => Promise<unknown>) {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    job()
      .catch((err) => {
        console.error(`${name} failed:`, err);
        reportError(err, { job: name });
      })
      .finally(() => {
        running = false;
      });
  }, ms);
}

async function main() {
  await connectMongo();
  every(30_000, "Pending-order expiry", () => expireStalePendingOrders(PENDING_ORDER_TIMEOUT_MINUTES));
  // Online payments: refunds still processing / to retry, and paid checkouts whose browser never came back.
  every(60_000, "Refund sync", syncGatewayRefunds);
  every(60_000, "Checkout reconcile", reconcileStaleCheckouts);
  app.listen(env.port, () => {
    console.log(`Chaap Di Haati RMS backend listening on port ${env.port} (${env.nodeEnv})`);
  });
}

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
  reportError(err, { kind: "unhandledRejection" });
});

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
