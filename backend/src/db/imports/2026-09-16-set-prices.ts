/**
 * Attaches real purchase prices to inventory items from the owner's price
 * list, converting "price per purchase unit" into paise-per-base-unit via
 * setInventoryItemCost (the same call the app's Purchases/Inventory screens
 * use), which also clears PRICE PENDING on each item it touches.
 *
 * Rows with no price on the sheet are left untouched (still PRICE PENDING).
 *
 * Two special cases from this price list:
 *  - Onion: didn't exist yet (skipped in the 15-Sept count — no agreed base
 *    unit). This price list gives it as "1 kg", which resolves that:
 *    created here as a g/kg item, with the 12.5kg from the 15-Sept sheet
 *    recorded as its opening stock, then priced.
 *  - Chutney Pack: a brand-new item not on the 15-Sept stock sheet at all —
 *    created here (qty 0, so a stock count is still owed) so its price
 *    isn't lost.
 *
 * Carry Bag is intentionally SKIPPED: its price is given as "₹180 / 1 pkt"
 * but the item is tracked in individual bags (piece), and how many bags
 * make up one packet was never given — converting would be a guess.
 *
 * Usage: npx tsx src/db/imports/2026-09-16-set-prices.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { InventoryItem, User } from "../models";
import { setInventoryItemCost, recordMovement } from "../../modules/inventory/inventory.service";
import { newId, nowIso } from "../../utils/ids";

const REASON = "Owner's purchase price list, 16 Sept 2026";

// paisePerBase = price(rupees) * 100 / quantity-in-base-units-per-purchase-unit
const PRICES: { name: string; paisePerBase: number }[] = [
  { name: "Cream", paisePerBase: (236.67 * 100) / 1000 },
  { name: "Kitchen King Masala", paisePerBase: (90 * 100) / 100 },
  { name: "Meat Masala", paisePerBase: (104 * 100) / 100 },
  { name: "Chicken Masala", paisePerBase: (85 * 100) / 100 },
  { name: "Garam Masala", paisePerBase: (104 * 100) / 100 },
  { name: "Degi Mirch", paisePerBase: (104 * 100) / 100 },
  { name: "Dhaniya Powder", paisePerBase: (260 * 100) / 1000 },
  { name: "Lal Mirch Powder", paisePerBase: (270 * 100) / 1000 },
  { name: "Haldi", paisePerBase: (280 * 100) / 1000 },
  { name: "Zira", paisePerBase: (70 * 100) / 250 },
  { name: "Black Pepper (whole)", paisePerBase: (200 * 100) / 250 },
  { name: "Chaat Masala", paisePerBase: (2000 * 100) / 5000 },
  { name: "Gota Kali Mirch", paisePerBase: (820 * 100) / 1000 },
  { name: "Tez Patta", paisePerBase: (20 * 100) / 100 },
  { name: "Sarso Oil", paisePerBase: (180 * 100) / 1000 },
  { name: "Refined Oil", paisePerBase: (2300 * 100) / 15000 },
  { name: "Besan", paisePerBase: (105 * 100) / 1000 },
  { name: "Butter", paisePerBase: (220 * 100) / 1000 },
  { name: "Ajino Moto", paisePerBase: (60 * 100) / 1000 },
  { name: "Amchur Powder", paisePerBase: (200 * 100) / 1000 },
  { name: "Sugar", paisePerBase: (65 * 100) / 1000 },
  { name: "Frozen Chaap", paisePerBase: (105 * 100) / 1000 },
  { name: "Lemon", paisePerBase: (20 * 100) / 4 },
  { name: "Coal", paisePerBase: (60 * 100) / 1000 },
  { name: "Kasturi Methi", paisePerBase: (260 * 100) / 1000 },
  { name: "Simla/Capsicum", paisePerBase: (50 * 100) / 1000 },
  { name: "Large Plate", paisePerBase: (150 * 100) / 5 },
  { name: "Small Plate", paisePerBase: (100 * 100) / 10 },
  { name: "Tissue", paisePerBase: (12 * 100) / 1 },
  { name: "Fork", paisePerBase: (90 * 100) / 2 },
  { name: "Toothpick", paisePerBase: (110 * 100) / 1 },
  { name: "Cap", paisePerBase: (65 * 100) / 1 },
];

async function main() {
  await connectMongo();

  const admin = await User.findOne({ username: "admin" });
  if (!admin) {
    console.error("No admin user found — run `npm run seed` first.");
    process.exit(1);
  }
  const ADMIN = admin._id;

  let priced = 0;
  const notFound: string[] = [];

  for (const p of PRICES) {
    const item = await InventoryItem.findOne({ name: p.name });
    if (!item) {
      notFound.push(p.name);
      continue;
    }
    await setInventoryItemCost(item._id, p.paisePerBase, REASON, ADMIN);
    priced++;
  }

  // Onion: resolve the unit ambiguity (kg/g, per this price list), create
  // it, record the 12.5kg from the 15-Sept count as opening stock, price it.
  let onion = await InventoryItem.findOne({ name: "Onion" });
  if (!onion) {
    const id = newId("inv");
    await withTransaction(async (session) => {
      await InventoryItem.create(
        [
          {
            _id: id,
            name: "Onion",
            category: "RAW_MATERIAL",
            baseUnit: "g",
            purchaseUnit: "kg",
            purchaseToBaseFactor: 1000,
            currentQtyBase: 0,
            minStockBase: 0,
            reorderLevelBase: 0,
            avgCostPaisePerBase: 0,
            pricePending: true,
            active: true,
            createdAt: nowIso(),
          },
        ],
        { session }
      );
      await recordMovement(
        {
          inventoryItemId: id,
          movementType: "OPENING_STOCK",
          direction: "IN",
          quantityBase: 12500,
          unitCostPaisePerBase: null,
          referenceType: "OPENING",
          reason: "Physical stock count, 2026-09-15 (unit resolved to kg/g by the 16-Sept price list)",
          businessDate: "2026-09-15",
          userId: ADMIN,
        },
        session
      );
    });
    onion = await InventoryItem.findById(id);
    console.log("Onion: created (kg/g base unit), opening stock 12.5kg.");
  }
  await setInventoryItemCost(onion!._id, (50 * 100) / 1000, REASON, ADMIN);
  priced++;

  // Chutney Pack: new item, not on the 15-Sept sheet — create at qty 0.
  let chutney = await InventoryItem.findOne({ name: "Chutney Pack" });
  if (!chutney) {
    const id = newId("inv");
    await InventoryItem.create({
      _id: id,
      name: "Chutney Pack",
      category: "RAW_MATERIAL",
      baseUnit: "piece",
      purchaseUnit: "packet",
      purchaseToBaseFactor: 1,
      currentQtyBase: 0,
      minStockBase: 0,
      reorderLevelBase: 0,
      avgCostPaisePerBase: 0,
      pricePending: true,
      active: true,
      createdAt: nowIso(),
    });
    chutney = await InventoryItem.findById(id);
    console.log("Chutney Pack: created (qty 0 — not on the 15-Sept sheet, needs a real count).");
  }
  await setInventoryItemCost(chutney!._id, (70 * 100) / 2, REASON, ADMIN);
  priced++;

  console.log(`\n✓ Priced ${priced} items.`);
  console.log(`⚠ Carry Bag skipped — price given per packet, but the item is tracked per bag with no known bags-per-packet.`);
  if (notFound.length) {
    console.log(`\n⚠ Not found in InventoryItem (name mismatch?):`);
    for (const name of notFound) console.log(`    - ${name}`);
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
