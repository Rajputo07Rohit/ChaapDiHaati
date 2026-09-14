/**
 * Per-item daily consumption from the owner's paper register, 4-12 Sept
 * 2026 (11-Sept and 13-Sept item-level breakdowns were never provided —
 * only day totals for those two exist, already in daily_closings).
 *
 * qty is the full-plate-equivalent (a half portion = 0.5); where the
 * register explicitly split full/half ("f3 hf3") both counts are kept.
 * Figures are entered exactly as written, including known register
 * arithmetic gaps — see the per-day discrepancy notes below.
 *
 * Usage: npx tsx src/db/imports/2026-09-item-level-sales.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
/* eslint-enable @typescript-eslint/no-var-requires */

interface Line {
  category: "Chaap" | "Paneer Tikka" | "Mushroom Tikka" | "Momo" | "Roll" | "Bread";
  name: string;
  full?: number;
  half?: number;
  qty?: number; // used when the register gives one undifferentiated full-plate-equivalent number
}

interface Day {
  date: string;
  lines: Line[];
  note?: string;
}

const DAYS: Day[] = [
  {
    date: "2026-09-04",
    lines: [
      { category: "Chaap", name: "Malai", qty: 4 },
      { category: "Chaap", name: "Punjabi", qty: 7 },
      { category: "Chaap", name: "Chatpata", qty: 0.5 },
      { category: "Chaap", name: "Achari", qty: 2 },
      { category: "Chaap", name: "Afgani", qty: 4 },
      { category: "Chaap", name: "Garlic", qty: 1.5 },
      { category: "Chaap", name: "Tikhi Titli", qty: 1 },
      { category: "Chaap", name: "Makhmali", qty: 1 },
      { category: "Chaap", name: "Peri Peri", qty: 2.5 },
      { category: "Paneer Tikka", name: "Dry", qty: 1 },
      { category: "Paneer Tikka", name: "Malai", qty: 1 },
      { category: "Momo", name: "Paneer Tandoori", qty: 1 },
      { category: "Momo", name: "Veg Tandoori", qty: 1 },
      { category: "Momo", name: "Veg Malai", qty: 0.5 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 1 },
      { category: "Roll", name: "Chatpata Chaap Roll", qty: 8 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 2 },
      { category: "Roll", name: "Hariyali Chaap Roll", qty: 1 },
      { category: "Roll", name: "Veg Lemon Chicken Tikka Chaap Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 40 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 6 },
    ],
    note: "Register's own Chaap subtotal (19.5) doesn't match the sum of these line items (23.5) — entered as itemised, not corrected.",
  },
  {
    date: "2026-09-05",
    lines: [
      { category: "Chaap", name: "Malai", qty: 10 },
      { category: "Chaap", name: "Punjabi", qty: 7.5 },
      { category: "Chaap", name: "Chatpata", qty: 0.5 },
      { category: "Chaap", name: "Achari", qty: 1.5 },
      { category: "Chaap", name: "Afgani", qty: 9 },
      { category: "Chaap", name: "Mint", qty: 0.5 },
      { category: "Chaap", name: "Tikhi Titli", qty: 0.5 },
      { category: "Chaap", name: "Veg Tandoori Leg", qty: 0.5 },
      { category: "Chaap", name: "Peri Peri", qty: 1 },
      { category: "Chaap", name: "Veg Chicken Tikka", qty: 1.5 },
      { category: "Paneer Tikka", name: "Garlic", qty: 0.5 },
      { category: "Momo", name: "Paneer Tandoori", qty: 2 },
      { category: "Momo", name: "Paneer Afgani", qty: 1 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 2 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 2.5 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 1 },
      { category: "Roll", name: "Paneer Tikka Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 63 },
    ],
    note: "Register's own Momo subtotal (4.5) doesn't match the sum of these line items (3) — entered as itemised, not corrected.",
  },
  {
    date: "2026-09-06",
    lines: [
      { category: "Chaap", name: "Malai", qty: 5 },
      { category: "Chaap", name: "Punjabi", qty: 3.5 },
      { category: "Chaap", name: "Chatpata", qty: 1.5 },
      { category: "Chaap", name: "Achari", qty: 2 },
      { category: "Chaap", name: "Afgani", qty: 5 },
      { category: "Chaap", name: "Tikhi Titli", qty: 2.5 },
      { category: "Chaap", name: "Veg Tandoori Leg", qty: 0.5 },
      { category: "Chaap", name: "Veg Chicken Tikka", qty: 0.5 },
      { category: "Paneer Tikka", name: "Garlic", qty: 0.5 },
      { category: "Momo", name: "Paneer Tandoori", qty: 0.5 },
      { category: "Momo", name: "Paneer Afgani", qty: 1 },
      { category: "Roll", name: "Malai Chaap Roll", qty: 1 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 1 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 1 },
      { category: "Roll", name: "Tikhi Titli Chaap Roll", qty: 1 },
      { category: "Roll", name: "Veg Chicken Tikka Chaap Roll", qty: 2 },
      { category: "Bread", name: "Rumali Roti", qty: 53 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 1 },
    ],
  },
  {
    date: "2026-09-07",
    lines: [
      { category: "Chaap", name: "Malai", full: 3, half: 3 },
      { category: "Chaap", name: "Punjabi", full: 9, half: 5 },
      { category: "Chaap", name: "Chatpata", full: 1 },
      { category: "Chaap", name: "Achari", full: 1, half: 2 },
      { category: "Chaap", name: "Afgani", full: 6, half: 2 },
      { category: "Chaap", name: "Garlic", full: 1 },
      { category: "Chaap", name: "Tikhi Titli", full: 2 },
      { category: "Chaap", name: "Peri Peri", half: 1 },
      { category: "Chaap", name: "Black Pepper", full: 1, half: 1 },
      { category: "Chaap", name: "Veg Chicken Tikka", half: 3 },
      { category: "Chaap", name: "Masala Stuffed", full: 2, half: 3 },
      { category: "Paneer Tikka", name: "Dry", full: 1 },
      { category: "Paneer Tikka", name: "Lemon", full: 1 },
      { category: "Momo", name: "Paneer Tandoori", full: 2, half: 1 },
      { category: "Roll", name: "Peri Peri Paneer Tikka Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 70 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 2 },
    ],
    note: "Chaap half-count sums to 20 across these lines vs the register's reported hf19 (diff 1 half) — a recurring gap seen on several other days too.",
  },
  {
    date: "2026-09-08",
    lines: [
      { category: "Chaap", name: "Malai", full: 3, half: 6 },
      { category: "Chaap", name: "Punjabi", full: 4, half: 4 },
      { category: "Chaap", name: "Chatpata", half: 1 },
      { category: "Chaap", name: "Achari", full: 1 },
      { category: "Chaap", name: "Afgani", full: 5, half: 7 },
      { category: "Chaap", name: "Garlic", half: 1 },
      { category: "Chaap", name: "Tikhi Titli", full: 1 },
      { category: "Chaap", name: "Makhmali", half: 3 },
      { category: "Chaap", name: "Masala Stuffed", half: 1 },
      { category: "Mushroom Tikka", name: "Afgani", qty: 1 },
      { category: "Momo", name: "Paneer Tandoori", half: 1 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 1 },
      { category: "Roll", name: "Malai Chaap Roll", qty: 3 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 2 },
      { category: "Roll", name: "Achari Chaap Roll", qty: 2 },
      { category: "Roll", name: "Peri Peri Chaap Roll", qty: 1 },
      { category: "Roll", name: "Peri Peri Paneer Tikka Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 89 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 4 },
    ],
  },
  {
    date: "2026-09-09",
    lines: [
      { category: "Chaap", name: "Malai", full: 2, half: 6 },
      { category: "Chaap", name: "Punjabi", half: 1 },
      { category: "Chaap", name: "Achari", full: 1, half: 2 },
      { category: "Chaap", name: "Afgani", full: 1, half: 3 },
      { category: "Chaap", name: "Lemon", half: 1 },
      { category: "Chaap", name: "Tikhi Titli", half: 2 },
      { category: "Chaap", name: "Makhmali", half: 1 },
      { category: "Chaap", name: "Peri Peri", full: 1 },
      { category: "Chaap", name: "Veg Chicken Tikka", full: 1, half: 1 },
      { category: "Mushroom Tikka", name: "Afgani", qty: 1 },
      { category: "Momo", name: "Paneer Tandoori", full: 1 },
      { category: "Momo", name: "Veg Tandoori", full: 1 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 2 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 1 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 1 },
      { category: "Roll", name: "Tikhi Titli Chaap Roll", qty: 1 },
      { category: "Roll", name: "Veg Lemon Chicken Tikka Chaap Roll", qty: 1 },
      { category: "Roll", name: "Peri Peri Chaap Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 38 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 5 },
    ],
    note: "Chaap half-count sums to 17 vs the register's reported hf16 (diff 1 half).",
  },
  {
    date: "2026-09-10",
    lines: [
      { category: "Chaap", name: "Malai", full: 2, half: 6 },
      { category: "Chaap", name: "Punjabi", half: 1 },
      { category: "Chaap", name: "Achari", full: 1, half: 2 },
      { category: "Chaap", name: "Afgani", full: 1, half: 3 },
      { category: "Chaap", name: "Lemon", half: 1 },
      { category: "Chaap", name: "Tikhi Titli", half: 2 },
      { category: "Chaap", name: "Makhmali", half: 1 },
      { category: "Chaap", name: "Peri Peri", full: 1 },
      { category: "Chaap", name: "Veg Chicken Tikka", full: 1, half: 1 },
      { category: "Mushroom Tikka", name: "Afgani", qty: 1 },
      { category: "Momo", name: "Paneer Tandoori", full: 1 },
      { category: "Momo", name: "Veg Tandoori", full: 1 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 2 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 1 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 1 },
      { category: "Roll", name: "Tikhi Titli Chaap Roll", qty: 1 },
      { category: "Roll", name: "Veg Lemon Chicken Tikka Chaap Roll", qty: 1 },
      { category: "Roll", name: "Peri Peri Chaap Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 120 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 5 },
    ],
    note: "The Chaap/Tikka/Momo/Roll item breakdown given for this day is byte-for-byte identical to 09-Sept's — almost certainly a copy/paste in the paper register rather than an independent count. Entered as given (only bread counts differ from 09-Sept), flagged for owner review rather than silently dropped.",
  },
  {
    date: "2026-09-12",
    lines: [
      { category: "Chaap", name: "Malai", full: 10, half: 6 },
      { category: "Chaap", name: "Punjabi", full: 5, half: 9 },
      { category: "Chaap", name: "Chatpata", full: 2, half: 1 },
      { category: "Chaap", name: "Achari", full: 3, half: 1 },
      { category: "Chaap", name: "Afgani", full: 2, half: 5 },
      { category: "Chaap", name: "Mint", half: 1 },
      { category: "Chaap", name: "Tikhi Titli", full: 1 },
      { category: "Chaap", name: "Makhmali", half: 1 },
      { category: "Chaap", name: "Peri Peri", full: 1, half: 1 },
      { category: "Chaap", name: "Masala Stuffed", full: 1, half: 1 },
      { category: "Momo", name: "Paneer Tandoori", full: 1, half: 1 },
      { category: "Momo", name: "Veg Tandoori", half: 1 },
      { category: "Roll", name: "Punjabi Chaap Roll", qty: 1 },
      { category: "Roll", name: "Malai Chaap Roll", qty: 1 },
      { category: "Roll", name: "Afgani Chaap Roll", qty: 2 },
      { category: "Roll", name: "Garlic Chaap Roll", qty: 1 },
      { category: "Roll", name: "Tikhi Titli Chaap Roll", qty: 1 },
      { category: "Roll", name: "Veg Lemon Chicken Tikka Chaap Roll", qty: 1 },
      { category: "Bread", name: "Rumali Roti", qty: 120 },
      { category: "Bread", name: "Butter Rumali Roti", qty: 5 },
    ],
    note: "Register claimed this day's Chaap count 'checks out' at F27/HF33, but the actual line items here sum to F25/HF26 — a real gap (2 full + 7 half) that the register's own check missed. Entered as itemised, not corrected.",
  },
];

const existingCount = (db.prepare("SELECT COUNT(*) as c FROM historical_item_sales").get() as { c: number }).c;
if (existingCount > 0) {
  console.error(`historical_item_sales already has ${existingCount} rows — refusing to re-run and duplicate. Delete them first if you really want to re-import.`);
  process.exit(1);
}

let inserted = 0;
const txn = db.transaction(() => {
  for (const day of DAYS) {
    for (const line of day.lines) {
      const full = line.full ?? 0;
      const half = line.half ?? 0;
      const qtyEquivalent = line.qty != null ? line.qty : full + half * 0.5;
      db.prepare(
        `INSERT INTO historical_item_sales (id, business_date, category, item_name, full_count, half_count, qty_equivalent, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId("hsale"),
        day.date,
        line.category,
        line.name,
        line.full ?? null,
        line.half ?? null,
        qtyEquivalent,
        day.note ?? null,
        nowIso()
      );
      inserted++;
    }
  }
});
txn();

console.log(`\n✓ Imported ${inserted} item-level sales lines across ${DAYS.length} days (04-10 & 12 Sept).`);
console.log(`  11-Sept and 13-Sept item-level breakdowns were not provided and are NOT in this table.`);
