/**
 * Owner's weekly ordering hours (IST):
 *   Mon–Fri  3:00 PM – 10:30 PM
 *   Sat–Sun  2:00 PM – 10:30 PM
 * Keeps the current mode (AUTO/OPEN/CLOSED) and closed message; only the
 * schedule changes. Same effect as saving it in Admin → Settings → Store Hours.
 *
 * Usage: npx tsx src/db/imports/2026-10-15-set-store-hours.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { getStoreHours, saveStoreHours, getStoreStatus } from "../../modules/storeStatus/storeStatus.service";

const weekday = { open: true, openTime: "15:00", closeTime: "22:30" };
const weekend = { open: true, openTime: "14:00", closeTime: "22:30" };

async function main() {
  await connectMongo();
  const current = await getStoreHours();
  console.log("Before:", JSON.stringify({ mode: current.mode, openTime: current.openTime, closeTime: current.closeTime, hasDays: !!current.days }));
  await saveStoreHours(
    // index 0 = Sunday … 6 = Saturday; openTime/closeTime = Monday's window, only read by older deploys
    { ...current, openTime: weekday.openTime, closeTime: weekday.closeTime, days: [weekend, weekday, weekday, weekday, weekday, weekday, weekend] },
    "system"
  );
  const s = await getStoreStatus();
  console.log("After:", JSON.stringify({ mode: s.mode, isOpen: s.isOpen, message: s.message, weekSummary: s.weekSummary }, null, 1));
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
