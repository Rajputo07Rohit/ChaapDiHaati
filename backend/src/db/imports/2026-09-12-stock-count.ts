/**
 * One-time import of the physical stock count taken on 12 Sept 2026.
 *
 * This is real business data, not demo/seed data — it runs through the
 * actual inventory service (recordMovement), the same code path the
 * Inventory screen uses, so every item gets a proper OPENING_STOCK movement
 * and audit trail rather than a row inserted by hand.
 *
 * No costs were given in this count, only quantities — every item is
 * created as PRICE PENDING. Run the Purchases screen (or a future import)
 * once real prices come in; that will clear PRICE PENDING automatically.
 *
 * Idempotent: skips any item that already exists by name, so re-running
 * this script after a partial failure won't create duplicates.
 *
 * Usage: npx tsx src/db/imports/2026-09-12-stock-count.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";

runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { recordMovement } = require("../../modules/inventory/inventory.service") as typeof import("../../modules/inventory/inventory.service");
const { recordAudit } = require("../../utils/audit") as typeof import("../../utils/audit");
/* eslint-enable @typescript-eslint/no-var-requires */

const BUSINESS_DATE = "2026-09-12";

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string } | undefined;
if (!admin) {
  console.error("No admin user found — run `npm run seed` first.");
  process.exit(1);
}
const ADMIN = admin.id;

type Category = "RAW_MATERIAL" | "PACKAGING" | "DISPOSABLE" | "OTHER";

interface StockLine {
  name: string;
  category: Category;
  baseUnit: "g" | "ml" | "piece";
  purchaseUnit: string;
  factor: number;
  qtyBase: number | null; // null => quantity genuinely not reported, left at 0
}

// Quantities converted to base units (g / ml / piece) from the counted
// units on the physical sheet. Where the sheet gave "(pack size) = count",
// the base quantity is count × pack size. Where it gave a bare number for a
// loose/weighed item (no "pkt"), that number is grams directly.
const RAW_MATERIALS: StockLine[] = [
  { name: "Cream", category: "RAW_MATERIAL", baseUnit: "ml", purchaseUnit: "packet", factor: 1000, qtyBase: 12 * 1000 },
  { name: "Cheese", category: "RAW_MATERIAL", baseUnit: "ml", purchaseUnit: "packet", factor: 1000, qtyBase: 1 * 1000 },
  { name: "Kitchen King Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 3 * 100 },
  { name: "Meat Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 2 * 100 },
  { name: "Chicken Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 2 * 100 },
  { name: "Garam Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 2 * 100 },
  { name: "Degi Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 2 * 100 },
  { name: "Dhaniya Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 1 * 500 },
  // Sheet says "= 5gm" (not "1 pkt" like its neighbours) — read literally as nearly finished.
  { name: "Lal Mirch Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 5 },
  { name: "Haldi", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 400 },
  { name: "Zira", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 340 },
  { name: "Black Pepper (whole)", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 300 },
  // "3pkt 180gm" at 1kg/packet = 3000g + 180g.
  { name: "Chaat Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 1000, qtyBase: 3 * 1000 + 180 },
  { name: "Gota Jeera", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 250 },
  { name: "Gota Kali Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 250 },
  { name: "Tez Patta", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 100 },
  { name: "Sarso Oil", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 0 },
  { name: "Refined Oil", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 6 * 1000 },
  { name: "Besan", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 780 },
  { name: "Ararot", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 880 },
  { name: "Ajino Moto", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 4 * 500 },
  { name: "Gota Lal Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 4 * 1000 },
  { name: "Badam", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 4850 },
  { name: "Tomato Ketchup", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "bottle", factor: 5000, qtyBase: 1 * 5000 },
  { name: "Green Chilli Sauce", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "bottle", factor: 5000, qtyBase: 1 * 5000 },
  { name: "Kala Namak", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 8 * 100 },
  { name: "Amchur Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 950 },
  // Packet size not given for Tata Namak — track "packet" itself as the unit.
  { name: "Tata Namak", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 3 },
  { name: "Sugar", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 200 },
  { name: "Red Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 2 },
  { name: "Green Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 1 },
  { name: "Yellow Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 1 },
  { name: "Adrak", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 1000 },
  { name: "Lahsun", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 2100 },
  { name: "Achar", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "jar", factor: 1, qtyBase: 1 },
  // "1 bora" (sack) — real sack weight wasn't given, so tracked in sacks rather than a guessed kg figure.
  { name: "Onion", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "bora", factor: 1, qtyBase: 1 },
  // No quantity given on the sheet ("Frozen chaap = kg") — item created, count left for a follow-up.
  { name: "Frozen Chaap", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: null },
  { name: "Lemon", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 10 },
  { name: "Mushroom", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "tin", factor: 1, qtyBase: 2 },
  { name: "Hara Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 200 },
  { name: "Ajwain", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 500 },
  { name: "Coal", category: "OTHER", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 20 * 1000 },
  { name: "Kasturi Methi", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 1000 },
  // No quantity given ("Simla =") — item created, count left for a follow-up.
  { name: "Simla/Capsicum", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: null },
  { name: "Curd", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 0 },
];

const DISPOSABLES: StockLine[] = [
  // No quantity given ("White plate = pkt") — item created, count left for a follow-up.
  { name: "White Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: null },
  { name: "Large Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 2 },
  { name: "Small Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 5 },
  { name: "Large Delivery Box", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 100 },
  { name: "Small Delivery Box", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 150 },
  { name: "Tissue", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 5 },
  { name: "Fork", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 0 },
  { name: "Toothpick", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 3 },
  { name: "Aluminium Foil", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "roll", factor: 1, qtyBase: 1 },
  { name: "Cap", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 1 },
  { name: "Carry Bag", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 1 },
];

const ALL = [...RAW_MATERIALS, ...DISPOSABLES];

let created = 0;
let skippedExisting = 0;
const missingCount: string[] = [];

const txn = db.transaction(() => {
  const now = nowIso();
  for (const line of ALL) {
    const existing = db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(line.name) as { id: string } | undefined;
    if (existing) {
      skippedExisting++;
      continue;
    }

    const id = newId("inv");
    db.prepare(
      `INSERT INTO inventory_items
        (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base,
         min_stock_base, reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, 1, ?)`
    ).run(id, line.name, line.category, line.baseUnit, line.purchaseUnit, line.factor, now);

    if (line.qtyBase != null && line.qtyBase > 0) {
      recordMovement({
        inventoryItemId: id,
        movementType: "OPENING_STOCK",
        direction: "IN",
        quantityBase: line.qtyBase,
        unitCostPaisePerBase: null, // no cost given yet — stays PRICE PENDING
        referenceType: "OPENING",
        reason: `Physical stock count, ${BUSINESS_DATE}`,
        businessDate: BUSINESS_DATE,
        userId: ADMIN,
      });
    } else if (line.qtyBase == null) {
      missingCount.push(line.name);
    }

    created++;
  }

  recordAudit({
    userId: ADMIN,
    action: "STOCK_IMPORTED",
    entityType: "inventory_item",
    newValue: { businessDate: BUSINESS_DATE, itemCount: created, source: "physical count sheet" },
    reason: `Bulk import of physical stock count for ${BUSINESS_DATE}`,
  });
});
txn();

console.log(`\n✓ Stock count for ${BUSINESS_DATE} imported.`);
console.log(`  ${created} items created, ${skippedExisting} already existed (skipped).`);
console.log(`  All items are PRICE PENDING — no costs were given in this count.`);
if (missingCount.length) {
  console.log(`\n⚠ No quantity was given for these — created at 0, need a real count:`);
  for (const name of missingCount) console.log(`    - ${name}`);
}
