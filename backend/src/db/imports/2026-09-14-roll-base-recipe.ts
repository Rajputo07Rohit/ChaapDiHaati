/**
 * Owner-defined flat recipe cost for rolls: ₹80/roll (Chaap Rolls + Paneer
 * Tikka Rolls, 23 items total, all SINGLE price type) — covers the
 * chaap/paneer filling, roti wrap, and sauce as one bundled figure, same
 * pattern as the chaap and momo base recipes (owner gave one number, not a
 * gram-by-gram breakdown, so it's stored as one bundled ingredient rather
 * than guessed individual quantities).
 *
 * Usage: npx tsx src/db/imports/2026-09-14-roll-base-recipe.ts
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

let rollMix = db.prepare("SELECT id FROM inventory_items WHERE name = 'Roll Filling & Wrap Mix'").get() as { id: string } | undefined;
if (!rollMix) {
  const id = newId("inv");
  db.prepare(
    `INSERT INTO inventory_items
      (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base,
       min_stock_base, reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
     VALUES (?, 'Roll Filling & Wrap Mix', 'RAW_MATERIAL', 'piece', 'serving', 1, 0, 0, 0, 8000, 0, 1, ?)`
  ).run(id, nowIso());
  rollMix = { id };
  console.log("Created bundled ingredient: Roll Filling & Wrap Mix @ ₹80/roll");
}
const MIX_ID = rollMix.id;

const rollItems = db
  .prepare(
    `SELECT mi.id, mi.name FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     WHERE mc.name IN ('Chaap Rolls', 'Paneer Tikka Rolls')`
  )
  .all() as { id: string; name: string }[];

let created = 0;
let skipped = 0;
for (const item of rollItems) {
  const existing = db
    .prepare("SELECT id FROM recipe_versions WHERE menu_item_id = ? AND price_type = 'SINGLE' AND effective_to IS NULL")
    .get(item.id);
  if (existing) {
    skipped++;
    continue;
  }
  const versionId = newId("recipe");
  db.prepare(
    `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, notes, created_by, created_at)
     VALUES (?, ?, 'SINGLE', 1, ?, ?, ?, ?)`
  ).run(
    versionId,
    item.id,
    nowIso(),
    "Owner-set flat roll cost: ₹80/roll (filling + wrap + sauce bundled, not broken into individual ingredients).",
    ADMIN,
    nowIso()
  );
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, 1, 0, 100, 0)`
  ).run(newId("ritem"), versionId, MIX_ID);
  created++;
}

recordAudit({
  userId: ADMIN,
  action: "RECIPE_CREATED",
  entityType: "recipe_version",
  newValue: { categories: ["Chaap Rolls", "Paneer Tikka Rolls"], itemsCovered: rollItems.length, flatCostPaise: 8000 },
  reason: "Bulk flat-cost recipe rollout for roll items per owner-confirmed ₹80/roll max cost",
});

console.log(`\n✓ ${created} recipes created, ${skipped} already existed (skipped).\n`);
const rows = db
  .prepare(
    `SELECT mc.name as category, mi.name, mp.price_paise
     FROM menu_items mi
     JOIN menu_categories mc ON mc.id = mi.category_id
     JOIN menu_prices mp ON mp.menu_item_id = mi.id
     WHERE mc.name IN ('Chaap Rolls', 'Paneer Tikka Rolls')
     ORDER BY mp.price_paise ASC`
  )
  .all() as { category: string; name: string; price_paise: number }[];

for (const r of rows) {
  const profit = r.price_paise - 8000;
  const margin = ((profit / r.price_paise) * 100).toFixed(1);
  console.log(`${r.name.padEnd(35)} ₹${(r.price_paise / 100).toFixed(0)}  cost ₹80  profit ₹${(profit / 100).toFixed(0)}  margin ${margin}%`);
}
