/**
 * Owner-defined base recipe for the Soya Chaap category, applied to all 17
 * standard chaap items (both HALF and FULL) — the Platter is excluded since
 * it's a larger combo with an unknown composition, still MISSING.
 *
 * Owner-given facts (not invented):
 *  - Raw chaap yield corrected from 1kg=4 full plates to 1kg=3.5 full plates.
 *    Raw Chaap (Frozen Chaap) = ₹105/kg -> ₹105/3.5 = ₹30.00 per full plate,
 *    ₹15.00 per half plate.
 *  - Cream + masala combined (not broken into individual spices, since the
 *    owner gave one bundled figure, not per-spice quantities) = ₹60/full
 *    plate, ₹30/half plate (scaled the same way as the chaap portion since
 *    no other split was given).
 *
 * "Cream & Masala Mix (Chaap Base)" is added as one bundled inventory item
 * priced exactly at the owner's stated ₹60/serving rather than guessing a
 * gram breakdown across Cream + several individual masala items — the
 * owner can split it into real ingredients later if they give exact
 * quantities.
 *
 * Usage: npx tsx src/db/imports/2026-09-14-chaap-base-recipe.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { recordAudit } = require("../../utils/audit") as typeof import("../../utils/audit");
/* eslint-enable @typescript-eslint/no-var-requires */

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string };
const ADMIN = admin.id;

// ---- 1. Bundled ingredient: Cream & Masala Mix ----
let mixItem = db.prepare("SELECT id FROM inventory_items WHERE name = 'Cream & Masala Mix (Chaap Base)'").get() as
  | { id: string }
  | undefined;
if (!mixItem) {
  const id = newId("inv");
  db.prepare(
    `INSERT INTO inventory_items
      (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base,
       min_stock_base, reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
     VALUES (?, 'Cream & Masala Mix (Chaap Base)', 'RAW_MATERIAL', 'piece', 'serving', 1, 0, 0, 0, 6000, 0, 1, ?)`
  ).run(id, nowIso());
  mixItem = { id };
  console.log("Created bundled ingredient: Cream & Masala Mix (Chaap Base) @ ₹60/serving");
}
const MIX_ID = mixItem.id;

// ---- 2. Raw chaap ingredient (already exists) ----
const chaapItem = db.prepare("SELECT id, avg_cost_paise_per_base FROM inventory_items WHERE name = 'Frozen Chaap'").get() as {
  id: string;
  avg_cost_paise_per_base: number;
};
const CHAAP_ID = chaapItem.id;

// Full plate: 1000g / 3.5 = 285.7142857g. Half: half of that.
const FULL_CHAAP_G = 1000 / 3.5;
const HALF_CHAAP_G = FULL_CHAAP_G / 2;

interface RecipeDef {
  menuItemName: string;
  priceType: "FULL" | "HALF";
  chaapG: number;
  mixCostPaise: number;
}

const items = db
  .prepare(
    `SELECT mi.id, mi.name FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mc.name = 'Soya Tandoori (Chaap)' AND mi.name != 'Desi Chaap Di Hatti Platter'`
  )
  .all() as { id: string; name: string }[];

let created = 0;
let skipped = 0;

function upsertRecipe(menuItemId: string, priceType: "FULL" | "HALF", chaapG: number, mixCostPaise: number, mixQty: number) {
  const existing = db
    .prepare("SELECT id FROM recipe_versions WHERE menu_item_id = ? AND price_type = ? AND effective_to IS NULL")
    .get(menuItemId, priceType);
  if (existing) {
    skipped++;
    return;
  }
  const versionId = newId("recipe");
  db.prepare(
    `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, notes, created_by, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    versionId,
    menuItemId,
    priceType,
    nowIso(),
    `Owner-defined base chaap recipe: raw chaap yield 1kg=3.5 full plates (₹105/kg), cream+masala bundled at ₹60/full serving. Not item-specific — same base cost applied across the Soya Chaap category; flavour-specific extras not yet broken out.`,
    ADMIN,
    nowIso()
  );
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, ?, 0, 100, 0)`
  ).run(newId("ritem"), versionId, CHAAP_ID, chaapG);
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, ?, 0, 100, 0)`
  ).run(newId("ritem"), versionId, MIX_ID, mixQty);
  created++;
}

for (const item of items) {
  upsertRecipe(item.id, "FULL", FULL_CHAAP_G, 6000, 1);
  upsertRecipe(item.id, "HALF", HALF_CHAAP_G, 3000, 0.5);
}

recordAudit({
  userId: ADMIN,
  action: "RECIPE_CREATED",
  entityType: "recipe_version",
  newValue: { category: "Soya Tandoori (Chaap)", itemsCovered: items.length, chaapYieldPerKg: 3.5, mixCostFullPaise: 6000 },
  reason: "Bulk base-recipe rollout for the Soya Chaap category per owner-confirmed yield and bundled cream+masala cost",
});

// ---- Show the resulting profit table ----
console.log(`\n✓ ${created} recipes created, ${skipped} already existed (skipped).\n`);
const rows = db
  .prepare(
    `SELECT mi.name, mp.price_type, mp.price_paise
     FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     JOIN menu_prices mp ON mp.menu_item_id = mi.id
     WHERE mc.name = 'Soya Tandoori (Chaap)' AND mi.name != 'Desi Chaap Di Hatti Platter'
     ORDER BY mi.name, mp.price_type`
  )
  .all() as { name: string; price_type: string; price_paise: number }[];

console.log("Item".padEnd(32), "Type".padEnd(6), "Price".padStart(8), "Cost".padStart(8), "Profit".padStart(8), "Margin");
for (const r of rows) {
  const costPaise = r.price_type === "FULL" ? 3000 + 6000 : 1500 + 3000;
  const profit = r.price_paise - costPaise;
  const margin = ((profit / r.price_paise) * 100).toFixed(1);
  console.log(
    r.name.padEnd(32),
    r.price_type.padEnd(6),
    `₹${(r.price_paise / 100).toFixed(0)}`.padStart(8),
    `₹${(costPaise / 100).toFixed(0)}`.padStart(8),
    `₹${(profit / 100).toFixed(0)}`.padStart(8),
    `${margin}%`
  );
}
