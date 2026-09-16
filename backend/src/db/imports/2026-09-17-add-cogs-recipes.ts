/**
 * Owner-provided rough COGS figures, converted into real recipe versions so
 * the app's actual profit reporting reflects them (previously most items
 * had no recipe at all — MISSING_RECIPE_AT_SALE, zero COGS).
 *
 * The owner gave flat total-cost-per-item numbers (not gram-level
 * ingredient breakdowns), e.g. "Rumali Roti = ₹10", "Chaap Roll = ₹50",
 * "Paneer Tandoori = ₹50 paneer + ₹70 spices = ₹120". Rather than inventing
 * fictitious gram quantities against real ingredients, each distinct flat
 * cost is represented as ONE recipe line against a synthetic "COGS bucket"
 * inventory item priced at exactly that per-unit cost — same math the real
 * recipe system already uses (recordMovement/computeRecipeCost), just with
 * a single all-in ingredient instead of a real breakdown. Each bucket is
 * opened with a very large quantity so it never shows a stock warning.
 *
 * Confirmed interpretations (asked the owner directly):
 *  - Chaap Roll ₹50 applies to every Chaap Rolls item (not just Rumali Roti,
 *    which gets its own ₹10 from the separate "bread roti" line).
 *  - Soya Tandoori Chaap: FULL costs more than HALF (FULL uses ~2x the raw
 *    chaap of HALF); spices (₹80) are flat regardless of size. Using
 *    Frozen Chaap's real cost (₹105/kg) and "1kg → 3-4 servings": FULL
 *    chaap ≈ 1000g/3.5 ≈ 286g ≈ ₹30, HALF ≈ 143g ≈ ₹15.
 *      FULL = ₹30 + ₹80 = ₹110, HALF = ₹15 + ₹80 = ₹95.
 *  - "Desi Chaap Di Hatti Platter" (FULL-only, ₹300, clearly a bigger
 *    combo) is INTENTIONALLY SKIPPED — no per-item breakdown was given for
 *    a platter and guessing felt worse than leaving it MISSING_RECIPE.
 *  - Mushroom Tandoori gets the exact same COGS as its matching Paneer
 *    Tandoori variant (Mushroom Tikka = Paneer Tikka [Dry]'s cost, etc.)
 *  - Veg Momo (all flavor variants) and Paneer Momo (all flavor variants)
 *    each get one flat number applied to BOTH Half and Full — the owner
 *    only asked for chaap to scale by size, not momo, so momo is left flat.
 *
 * Idempotent: uses the same versioning the real recipe-creation route uses
 * (closes any existing open version first), so re-running just supersedes.
 *
 * Usage: npx tsx src/db/imports/2026-09-17-add-cogs-recipes.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { MenuItem, RecipeVersion, User, InventoryItem } from "../models";
import { createInventoryItem } from "../../modules/inventory/inventory.service";
import { newId, nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";

type PriceType = "HALF" | "FULL" | "SINGLE";

// Distinct flat COGS values (rupees) needed across every mapping below.
const BUCKET_VALUES_RUPEES = [10, 14, 50, 80, 95, 100, 110, 120];

const CHAAP_ROLLS = [
  "Malai Chaap Roll", "Punjabi Chaap Roll", "Chatpata Chaap Roll", "Afghani Chaap Roll", "Achari Chaap Roll",
  "Garlic Chaap Roll", "Lemon Chaap Roll", "Hariyali Chaap Roll", "Tikhi Titli Chaap Roll", "Makhmali Chaap Roll",
  "Black Pepper Chaap Roll", "Hari Mirch Chaap Roll", "Veg Chicken Tikka Chaap Roll", "Veg Lemon Chicken Tikka Chaap Roll",
  "Peri Peri Chaap Roll",
];

const PANEER_TIKKA_ROLLS = [
  "Paneer Tikka Roll", "Malai Paneer Tikka Roll", "Afghani Paneer Tikka Roll", "Hariyali Paneer Tikka Roll",
  "Garlic Paneer Tikka Roll", "Achari Paneer Tikka Roll", "Lemon Paneer Tikka Roll", "Peri Peri Paneer Tikka Roll",
];

// Every Soya Tandoori (Chaap) item EXCEPT the platter (skipped — see header).
const SOYA_CHAAP = [
  "Malai Chaap", "Punjabi Chaap", "Chatpata Chaap", "Aachari Chaap", "Afghani Chaap", "Garlic Chaap", "Lemon Chaap",
  "Mint Pudina Chaap", "Tikhi Titli", "Makhmali Chaap", "Veg Tandoori Leg Pc.", "Peri Peri Chaap", "Black Pepper Chaap",
  "Hari Mirch Chaap", "Veg Chicken Tikka Chaap", "Veg Lemon Chicken Tikka Chaap", "Masala Stuffed Chaap",
];

const PANEER_TANDOORI = [
  "Paneer Tikka [Dry]", "Malai Paneer Tikka", "Punjabi Paneer Tikka", "Afghani Paneer Tikka", "Hariyali Paneer Tikka",
  "Garlic Paneer Tikka", "Achari Paneer Tikka", "Lemon Paneer Tikka", "Peri Peri Paneer Tikka",
];

// Mushroom Tandoori item -> its matching Paneer Tandoori item (same COGS).
const MUSHROOM_TO_PANEER: Record<string, string> = {
  "Mushroom Tikka": "Paneer Tikka [Dry]",
  "Mushroom Malai Tikka": "Malai Paneer Tikka",
  "Afghani Mushroom Tikka": "Afghani Paneer Tikka",
  "Hariyali Mushroom Tikka": "Hariyali Paneer Tikka",
  "Garlic Mushroom Tikka": "Garlic Paneer Tikka",
  "Achari Mushroom Tikka": "Achari Paneer Tikka",
  "Peri Peri Mushroom Tikka": "Peri Peri Paneer Tikka",
};

const VEG_MOMO = ["Veg Tandoori Momo", "Veg Malai Momo", "Veg Afghani Momo", "Veg Achari Momo", "Veg Peri Peri Momo"];
const PANEER_MOMO = ["Paneer Tandoori Momo", "Paneer Malai Momo", "Paneer Afghani Momo", "Paneer Achari Momo", "Paneer Peri Peri Momo"];

interface Line {
  itemName: string;
  priceType: PriceType;
  costRupees: number;
}

async function main() {
  await connectMongo();
  const admin = await User.findOne({ username: "admin" });
  if (!admin) throw new Error("No admin user found.");
  const ADMIN = admin._id;

  // 1) Create the flat-cost bucket inventory items (skip if already made by a previous run).
  const bucketIdByValue = new Map<number, string>();
  for (const rupees of BUCKET_VALUES_RUPEES) {
    const name = `Recipe Cost Bucket ₹${rupees}`;
    let item = await InventoryItem.findOne({ name });
    if (!item) {
      const id = await createInventoryItem(
        {
          name,
          category: "OTHER",
          baseUnit: "piece",
          purchaseUnit: "unit",
          purchaseToBaseFactor: 1,
          minStockBase: 0,
          reorderLevelBase: 0,
          openingQtyBase: 1_000_000, // never actually runs out — it's a synthetic flat-cost line, not a real stock count
          openingCostPaisePerBase: rupees * 100,
          pricePending: false,
        },
        ADMIN
      );
      item = await InventoryItem.findById(id);
      console.log(`Created bucket: ${name}`);
    }
    bucketIdByValue.set(rupees, item!._id);
  }

  // 2) Build the full (menuItem, priceType, cost) line list.
  const lines: Line[] = [];
  for (const name of CHAAP_ROLLS) lines.push({ itemName: name, priceType: "SINGLE", costRupees: 50 });
  for (const name of PANEER_TIKKA_ROLLS) lines.push({ itemName: name, priceType: "SINGLE", costRupees: 80 });
  lines.push({ itemName: "Rumali Roti", priceType: "SINGLE", costRupees: 10 });
  lines.push({ itemName: "Butter Rumali Roti", priceType: "SINGLE", costRupees: 14 });
  for (const name of SOYA_CHAAP) {
    lines.push({ itemName: name, priceType: "HALF", costRupees: 95 });
    lines.push({ itemName: name, priceType: "FULL", costRupees: 110 });
  }
  for (const name of PANEER_TANDOORI) lines.push({ itemName: name, priceType: "SINGLE", costRupees: 120 });
  for (const mushroom of Object.keys(MUSHROOM_TO_PANEER)) lines.push({ itemName: mushroom, priceType: "SINGLE", costRupees: 120 });
  for (const name of VEG_MOMO) {
    lines.push({ itemName: name, priceType: "HALF", costRupees: 80 });
    lines.push({ itemName: name, priceType: "FULL", costRupees: 80 });
  }
  for (const name of PANEER_MOMO) {
    lines.push({ itemName: name, priceType: "HALF", costRupees: 100 });
    lines.push({ itemName: name, priceType: "FULL", costRupees: 100 });
  }

  // 3) Create a recipe version per line — same versioning rule the real
  // POST /recipes route uses: close any currently-open version first.
  const now = nowIso();
  let created = 0;
  const notFound: string[] = [];

  for (const line of lines) {
    const menuItem = await MenuItem.findOne({ name: line.itemName });
    if (!menuItem) {
      notFound.push(line.itemName);
      continue;
    }
    const bucketId = bucketIdByValue.get(line.costRupees)!;

    await withTransaction(async (session) => {
      const previous = await RecipeVersion.findOne({ menuItemId: menuItem._id, priceType: line.priceType, effectiveTo: null }).session(session);
      if (previous) {
        previous.effectiveTo = now;
        await previous.save({ session });
      }
      const versionId = newId("recipe");
      await RecipeVersion.create(
        [
          {
            _id: versionId,
            menuItemId: menuItem._id,
            priceType: line.priceType,
            version: (previous?.version ?? 0) + 1,
            effectiveFrom: now,
            effectiveTo: null,
            notes: `Flat COGS ₹${line.costRupees} — owner-provided estimate, 17 Sept 2026`,
            createdBy: ADMIN,
            createdAt: now,
            recipeItems: [{ inventoryItemId: bucketId, quantityBase: 1, wastagePct: 0, yieldPct: 100, optional: false }],
          },
        ],
        { session }
      );
      await recordAudit(
        {
          userId: ADMIN,
          action: "RECIPE_CHANGED",
          entityType: "menu_item",
          entityId: menuItem._id,
          oldValue: previous ? { previousVersionId: previous._id } : null,
          newValue: { versionId, priceType: line.priceType, flatCogsRupees: line.costRupees },
          reason: "Owner-provided flat COGS estimate",
        },
        session
      );
    });
    created++;
  }

  console.log(`\n✓ Created/updated ${created} recipe version(s).`);
  if (notFound.length) {
    console.log(`\n⚠ Menu items not found (name mismatch?):`);
    for (const n of [...new Set(notFound)]) console.log(`    - ${n}`);
  }
  console.log(`\n⚠ Skipped intentionally: "Desi Chaap Di Hatti Platter" (FULL-only ₹300) — no per-item breakdown given for this platter.`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
