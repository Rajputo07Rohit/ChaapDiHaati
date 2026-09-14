/**
 * Rumali Roti and Butter Rumali Roti are bought ready-made (per the 06/09/11
 * Sept purchase bills — ₹10/pc and ₹12/pc) and sold as-is, no kitchen prep.
 * That makes them the one place on the menu where a recipe is NOT a guess —
 * it's exactly 1 purchased piece = 1 sold piece. This links the two
 * inventory items (renamed to match the menu item names exactly, since they
 * were previously just "Rumali" / "Butter Rumali") to their menu items via a
 * real recipe_version + recipe_item, so COGS is calculable for these two
 * items immediately, ahead of the rest of the menu's recipes.
 *
 * Usage: npx tsx src/db/imports/2026-09-rumali-recipe-link.ts
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

const LINKS = [
  { invName: "Rumali", menuName: "Rumali Roti" },
  { invName: "Butter Rumali", menuName: "Butter Rumali Roti" },
];

const txn = db.transaction(() => {
  for (const l of LINKS) {
    // Rename the inventory item to match the menu item exactly.
    db.prepare("UPDATE inventory_items SET name = ? WHERE name = ?").run(l.menuName, l.invName);
    const invItem = db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(l.menuName) as { id: string };
    const menuItem = db.prepare("SELECT id FROM menu_items WHERE name = ?").get(l.menuName) as { id: string } | undefined;
    if (!menuItem) {
      console.error(`Menu item not found: ${l.menuName} — skipping recipe link.`);
      continue;
    }

    const existing = db
      .prepare("SELECT id FROM recipe_versions WHERE menu_item_id = ? AND price_type = 'SINGLE' AND effective_to IS NULL")
      .get(menuItem.id);
    if (existing) {
      console.log(`Recipe already exists for ${l.menuName} — skipping.`);
      continue;
    }

    const versionId = newId("recipe");
    db.prepare(
      `INSERT INTO recipe_versions (id, menu_item_id, price_type, version, effective_from, notes, created_by, created_at)
       VALUES (?, ?, 'SINGLE', 1, ?, ?, ?, ?)`
    ).run(versionId, menuItem.id, nowIso(), "Bought ready-made and sold as-is — 1:1 pass-through, no prep.", ADMIN, nowIso());

    db.prepare(
      `INSERT INTO recipe_items (id, recipe_version_id, inventory_item_id, quantity_base, wastage_pct, yield_pct, optional)
       VALUES (?, ?, ?, 1, 0, 100, 0)`
    ).run(newId("ritem"), versionId, invItem.id);

    recordAudit({
      userId: ADMIN,
      action: "RECIPE_CREATED",
      entityType: "recipe_version",
      entityId: versionId,
      newValue: { menuItem: l.menuName, inventoryItem: l.menuName, quantityBase: 1 },
      reason: "1:1 recipe for a ready-made, no-prep item",
    });
  }
});
txn();

console.log("✓ Rumali Roti / Butter Rumali Roti renamed and linked with 1:1 recipes.");
