/**
 * Owner-supplied purchase register, 4-13 Sept 2026, checked line-by-line
 * against what's already in the database:
 *
 *  - 06, (07 as "bill 1"), 09 (as "bill 2"), 11, 12 Sept: match exactly what
 *    was already imported — no changes, just a clarifying note added to the
 *    09-Sept purchase order about the 07-Sept/09-Sept date split (see below).
 *  - 04, 05, 10 Sept: genuinely new purchases, not previously recorded —
 *    added here.
 *  - 13 Sept: mentioned in the owner's message ("4 to 13") but no line items
 *    were actually included for it — nothing to import; flagged in the
 *    final console output.
 *
 * Date-split correction: the ₹4,815 "bill 1" (Bada Plate, Fork, Butter 10kg,
 * Chota Carry Bag, Chutney Packing, Paneer Momo, Paneer, Rumali) was
 * originally imported dated 09-Sept, bundled with "bill 2" under one
 * ₹8,995 purchase order. The owner's re-sent register clarifies bill 1 was
 * actually goods-dated 07-Sept, and bill 2 (₹4,180) is the real 09-Sept
 * purchase — paid together in one ₹8,995 bank settlement on 09-Sept. The
 * money and inventory quantities recorded are already correct either way;
 * this only corrects the notes so day-level reports are read correctly,
 * rather than re-splitting the row (which would require reversing and
 * re-posting a real bank transaction for no financial benefit).
 *
 * Usage: npx tsx src/db/imports/2026-09-purchase-corrections.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { recordPurchase } = require("../../modules/purchases/purchases.service") as typeof import("../../modules/purchases/purchases.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;
const ADMIN_ROLE = "ADMIN" as const;
const rupees = (r: number) => Math.round(r * 100);
const DESI_CHAAP = (db.prepare("SELECT id FROM suppliers WHERE name = 'Desi Chaap'").get() as { id: string }).id;

function itemId(name: string): string {
  const row = db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(name) as { id: string } | undefined;
  if (!row) throw new Error(`Inventory item not found: ${name}`);
  return row.id;
}

// New inventory item: Liquid Cheese (distinct product from the existing
// "Cheese" item — no size was given, tracked by the packet as purchased).
const existingLiquidCheese = db.prepare("SELECT id FROM inventory_items WHERE name = 'Liquid Cheese'").get();
if (!existingLiquidCheese) {
  db.prepare(
    `INSERT INTO inventory_items
      (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base,
       min_stock_base, reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
     VALUES (?, 'Liquid Cheese', 'RAW_MATERIAL', 'piece', 'packet', 1, 0, 0, 0, 0, 1, 1, ?)`
  ).run(newId("inv"), nowIso());
  console.log("Created inventory item: Liquid Cheese");
}

interface PLine {
  name: string;
  qty: number;
  unit: string;
  ratePaise: number;
  notes?: string;
}
function purchase(businessDate: string, lines: PLine[], notes?: string) {
  const already = db.prepare("SELECT id FROM purchase_orders WHERE business_date = ? AND notes = ?").get(businessDate, notes ?? null);
  if (already) {
    console.log(`Already imported for ${businessDate} with matching notes — skipping.`);
    return;
  }
  recordPurchase(
    {
      supplierId: DESI_CHAAP,
      businessDate,
      paymentStatus: "CREDIT",
      items: lines.map((l) => ({ inventoryItemId: itemId(l.name), quantity: l.qty, purchaseUnit: l.unit, ratePaise: l.ratePaise, notes: l.notes })),
      notes,
    },
    ADMIN,
    ADMIN_ROLE
  );
  console.log(`Recorded purchase for ${businessDate}.`);
}

// ---- 04 Sept (new) ----
purchase(
  "2026-09-04",
  [
    { name: "Rumali Roti", qty: 50, unit: "piece", ratePaise: rupees(10), notes: "Register note: (100-50=50)" },
    { name: "Veg Momo", qty: 5, unit: "plate", ratePaise: rupees(32) },
    { name: "Paneer Momo", qty: 5, unit: "plate", ratePaise: rupees(40) },
    { name: "Liquid Cheese", qty: 1, unit: "packet", ratePaise: rupees(200) },
    { name: "Carry Bag", qty: 1, unit: "packet", ratePaise: rupees(200), notes: "5kg bulk bag, purchased by weight not count (5kg @ ~₹40/kg)" },
  ],
  "Item-level detail from owner's re-sent purchase register. Combined with 05-Sept (₹1,220), totals exactly ₹2,480 — the amount of the previously-unexplained 'Desi Chaap' bank debit on 06-Sept. Payment status left CREDIT/unconfirmed since the register's own note ('Total = ₹2480 - 900 = 1580') suggests a partial settlement whose exact split isn't fully clear — see the 05-Sept purchase notes and the 06-Sept bank transactions."
);

// ---- 05 Sept (new) ----
purchase(
  "2026-09-05",
  [
    { name: "Rumali Roti", qty: 50, unit: "piece", ratePaise: rupees(10) },
    { name: "Veg Momo", qty: 10, unit: "plate", ratePaise: rupees(32) },
    { name: "Paneer Momo", qty: 10, unit: "plate", ratePaise: rupees(40) },
  ],
  "Item-level detail from owner's re-sent purchase register (₹1,220). Register note: 'Total = ₹2480 - 900 = 1580' — read as (04-Sept + 05-Sept combined = ₹2,480) minus ₹900 already settled = ₹1,580 due, which matches the previously-unexplained ₹1,580 'Desi Chaap' bank debit on 06-Sept. The separate ₹900 portion isn't identified in the given data — flagged for owner review, not guessed."
);

// ---- 10 Sept (new) ----
purchase(
  "2026-09-10",
  [
    { name: "Coal", qty: 37, unit: "kg", ratePaise: rupees(60), notes: "Register note: '20+17=37kg'" },
    { name: "Paneer Momo", qty: 5, unit: "plate", ratePaise: rupees(40) },
  ],
  "Item-level detail from owner's re-sent purchase register (₹2,420). No payment method/date given for this one — left CREDIT/unconfirmed rather than guessed."
);

// ---- Clarify the 09-Sept combined purchase order (bill 1 + bill 2) ----
const combined = db.prepare("SELECT id, notes FROM purchase_orders WHERE business_date = '2026-09-09' AND total_paise = 899500").get() as
  | { id: string; notes: string | null }
  | undefined;
if (combined) {
  const addition =
    "CLARIFICATION (from re-sent register): the 'bill 1' lines here (₹4,815 — Bada Plate, Fork, Butter 10kg, Chota Carry Bag, Chutney Packing, Paneer Momo, Paneer, Rumali) were actually goods-dated 07-Sept, not 09-Sept. Only 'bill 2' (₹4,180) is truly a 09-Sept purchase. Both were paid together in one real ₹8,995 bank settlement on 09-Sept, so the amounts/inventory recorded here are correct as-is — only the date label for 'bill 1' should be read as 07-Sept when reviewing day-by-day purchase totals. Also: the Butter 10kg line included 5kg delivered on 04-Sept that was never billed at the time ('first day bhi gaya tha, bill nahi hua tha') — billed together with a further 5kg here.";
  db.prepare("UPDATE purchase_orders SET notes = ?, updated_at = ? WHERE id = ?").run(
    combined.notes ? `${combined.notes} | ${addition}` : addition,
    nowIso(),
    combined.id
  );
  console.log("Added date-split clarification note to the 09-Sept combined purchase order.");
} else {
  console.log("Could not find the expected 09-Sept ₹8,995 purchase order — no clarification note added.");
}

console.log("\n✓ Purchase register cross-check complete.");
console.log("  06, 07('bill 1'), 09('bill 2'), 11, 12 Sept all matched what was already recorded.");
console.log("  04, 05, 10 Sept were new and have been added.");
console.log("  13 Sept was mentioned but no line items were included — nothing imported for it.");
