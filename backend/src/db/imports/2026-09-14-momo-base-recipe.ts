/**
 * Owner-defined base recipe for the Momo category (10 items x HALF/FULL),
 * same pattern as the chaap rollout: a purchased base item + the bundled
 * "Cream & Masala Mix" finishing cost the owner set at ₹60/full serving.
 *
 * Veg Momo base = ₹32/plate (already a real purchase price).
 * Paneer Momo base = ₹40/plate (already a real purchase price).
 * Full serving = 1x base momo + Mix(₹60). Half = 0.5x base momo + Mix(₹30),
 * scaled the same way as the chaap recipes.
 *
 * Usage: npx tsx src/db/imports/2026-09-14-momo-base-recipe.ts
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

const MIX_ID = (db.prepare("SELECT id FROM inventory_items WHERE name = 'Cream & Masala Mix (Chaap Base)'").get() as { id: string }).id;
const VEG_MOMO_ID = (db.prepare("SELECT id FROM inventory_items WHERE name = 'Veg Momo'").get() as { id: string }).id;
const PANEER_MOMO_ID = (db.prepare("SELECT id FROM inventory_items WHERE name = 'Paneer Momo'").get() as { id: string }).id;

function upsertRecipe(menuItemId: string, priceType: "FULL" | "HALF", baseId: string, baseQty: number, mixQty: number, label: string) {
  const existing = db
    .prepare("SELECT id FROM recipe_versions WHERE menu_item_id = ? AND price_type = ? AND effective_to IS NULL")
    .get(menuItemId, priceType);
  if (existing) return false;

  const versionId = newId("recipe");
  db.prepare(
    `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, notes, created_by, created_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(
    versionId,
    menuItemId,
    priceType,
    nowIso(),
    `Owner-defined base momo recipe: 1 purchased ${label} plate + cream/masala finishing bundled at ₹60/full serving. Same base cost applied across all flavours of this momo type; flavour-specific sauces not yet broken out.`,
    ADMIN,
    nowIso()
  );
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, ?, 0, 100, 0)`
  ).run(newId("ritem"), versionId, baseId, baseQty);
  db.prepare(
    `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
     VALUES (?, ?, ?, ?, 0, 100, 0)`
  ).run(newId("ritem"), versionId, MIX_ID, mixQty);
  return true;
}

const momoItems = db
  .prepare(`SELECT mi.id, mi.name FROM menu_items mi JOIN menu_categories mc ON mc.id = mi.category_id WHERE mc.name = 'Momo'`)
  .all() as { id: string; name: string }[];

let created = 0;
let skipped = 0;
for (const item of momoItems) {
  const isPaneer = item.name.toLowerCase().startsWith("paneer");
  const baseId = isPaneer ? PANEER_MOMO_ID : VEG_MOMO_ID;
  const label = isPaneer ? "Paneer Momo" : "Veg Momo";
  if (upsertRecipe(item.id, "FULL", baseId, 1, 1, label)) created++;
  else skipped++;
  if (upsertRecipe(item.id, "HALF", baseId, 0.5, 0.5, label)) created++;
  else skipped++;
}

recordAudit({
  userId: ADMIN,
  action: "RECIPE_CREATED",
  entityType: "recipe_version",
  newValue: { category: "Momo", itemsCovered: momoItems.length, mixCostFullPaise: 6000 },
  reason: "Bulk base-recipe rollout for the Momo category per owner-confirmed cream+masala finishing cost",
});

console.log(`\n✓ ${created} recipes created, ${skipped} already existed (skipped).`);
