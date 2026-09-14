/**
 * 1) Corrects two 14-Sept stock-count lines against the owner's re-sent,
 *    more precise stock report:
 *      - Chaat Masala: was entered as 2.5 pkt (2500g) from the summarized
 *        master notes; the owner's own re-send says "2 pkt 730 gm" = 2730g.
 *      - Onion: was entered as 40 (bora) — a misreading of the original
 *        master notes ("Onion = 40kg"); the owner's own re-send clarifies
 *        it's 1 bora, not 40. The item is tracked in whole sacks (no real
 *        per-sack weight was ever given), so "40" was wrong by 39 sacks.
 *    Everything else in the re-sent report matches what's already recorded.
 *
 * 2) Opens business day 2026-09-14 in daily_closings so the app's normal
 *    Daily Closing flow (and therefore automatic day-by-day profit/cash
 *    tracking) starts running from today forward, carrying the real
 *    cumulative cash ledger balance forward as the opening figure.
 *
 * Usage: npx tsx src/db/imports/2026-09-14-stock-correction-and-dayopen.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { recordMovement } = require("../../modules/inventory/inventory.service") as typeof import("../../modules/inventory/inventory.service");
const { openBusinessDay } = require("../../modules/dailyClosing/dailyClosing.service") as typeof import("../../modules/dailyClosing/dailyClosing.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;
const BUSINESS_DATE = "2026-09-14";

function itemId(name: string): string {
  return (db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(name) as { id: string }).id;
}

const CORRECTIONS: { name: string; correctQtyBase: number }[] = [
  { name: "Chaat Masala", correctQtyBase: 2730 },
  { name: "Onion", correctQtyBase: 1 },
];

for (const c of CORRECTIONS) {
  const id = itemId(c.name);
  const current = (db.prepare("SELECT current_qty_base FROM inventory_items WHERE id = ?").get(id) as { current_qty_base: number }).current_qty_base;
  const delta = c.correctQtyBase - current;
  if (delta === 0) {
    console.log(`${c.name}: already correct (${current}).`);
    continue;
  }
  recordMovement({
    inventoryItemId: id,
    movementType: "STOCK_ADJUSTMENT",
    direction: delta > 0 ? "IN" : "OUT",
    quantityBase: Math.abs(delta),
    unitCostPaisePerBase: null,
    referenceType: "STOCK_COUNT",
    reason: `Correction from owner's re-sent 14-Sept stock report (was ${current}, corrected to ${c.correctQtyBase})`,
    businessDate: BUSINESS_DATE,
    userId: ADMIN,
    allowNegativeStock: true,
  });
  console.log(`${c.name}: corrected ${current} -> ${c.correctQtyBase}`);
}

const openingCashPaise = (
  db.prepare("SELECT COALESCE(SUM(CASE WHEN direction='IN' THEN amount_paise ELSE -amount_paise END),0) as t FROM cash_transactions").get() as {
    t: number;
  }
).t;

const closing = openBusinessDay(BUSINESS_DATE, openingCashPaise, ADMIN);
console.log(`\n✓ Business day ${BUSINESS_DATE} is now OPEN (status=${closing.status}), opening cash snapshot ₹${(openingCashPaise / 100).toFixed(2)}.`);
console.log(`  Sales rung up through the POS from today on will feed real COGS/profit automatically once recipes exist.`);
