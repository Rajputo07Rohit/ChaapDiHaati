/**
 * Physical stock count taken on 15 Sept 2026.
 *
 * The 12-Sept and 14-Sept stock-count scripts were written against the old
 * SQLite store and were never actually run against the live Mongo database
 * (InventoryItem was empty except for two items created by an earlier run
 * of this file). So this is effectively the first real inventory count in
 * the live system: every item on today's sheet is created fresh here, with
 * an OPENING_STOCK movement for whatever quantity was reported (0 where the
 * sheet says 0).
 *
 * No costs were given, only quantities — every item is created as PRICE
 * PENDING. Idempotent: skips any item that already exists by name.
 *
 * Onion is intentionally SKIPPED: the sheet gives "12.5kg", but there's no
 * agreed base unit for onion yet (earlier drafts of this data tracked it in
 * whole sacks with an unknown per-sack weight). Printed as a warning —
 * needs a manual decision on which unit to track it in before creating it.
 *
 * Usage: npx tsx src/db/imports/2026-09-15-stock-count.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { withTransaction } from "../../db/mongoose";
import { InventoryItem, User } from "../models";
import { recordMovement } from "../../modules/inventory/inventory.service";
import { recordAudit } from "../../utils/audit";
import { newId, nowIso } from "../../utils/ids";

const BUSINESS_DATE = "2026-09-15";

type Category = "RAW_MATERIAL" | "PACKAGING" | "DISPOSABLE" | "OTHER";

interface StockLine {
  name: string;
  category: Category;
  baseUnit: "g" | "ml" | "piece";
  purchaseUnit: string;
  factor: number;
  qtyBase: number;
}

const RAW_MATERIALS: StockLine[] = [
  { name: "Cream", category: "RAW_MATERIAL", baseUnit: "ml", purchaseUnit: "packet", factor: 1000, qtyBase: 8 * 1000 },
  { name: "Cheese", category: "RAW_MATERIAL", baseUnit: "ml", purchaseUnit: "packet", factor: 1000, qtyBase: 970 },
  { name: "Kitchen King Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 1 * 100 },
  { name: "Meat Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 2 * 100 + 50 },
  { name: "Chicken Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 3 * 100 + 70 },
  { name: "Garam Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 5 * 100 },
  { name: "Degi Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 6 * 100 + 20 },
  { name: "Dhaniya Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 2 * 500 + 160 },
  { name: "Lal Mirch Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 380 },
  { name: "Haldi", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 400 },
  { name: "Zira", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 330 },
  { name: "Black Pepper (whole)", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 600 },
  { name: "Chaat Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 1000, qtyBase: 2 * 1000 + 280 },
  { name: "Gota Jeera", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 70 },
  { name: "Gota Kali Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 250 },
  { name: "Tez Patta", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 100 },
  { name: "Sarso Oil", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 980 },
  { name: "Refined Oil", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 13 * 1000 },
  { name: "Besan", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 760 },
  { name: "Ararot", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 860 },
  { name: "Butter", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 0 },
  { name: "Ajino Moto", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 3 * 500 },
  { name: "Gota Lal Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: Math.round(3.9 * 1000) },
  { name: "Badam", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: Math.round(2.7 * 1000) },
  { name: "Tomato Ketchup", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "bottle", factor: 5000, qtyBase: 1 * 5000 },
  { name: "Green Chilli Sauce", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "bottle", factor: 5000, qtyBase: 1 * 5000 },
  { name: "Kala Namak", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 6 * 100 },
  { name: "Amchur Powder", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 940 },
  { name: "Tata Namak", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 3 },
  { name: "Sugar", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 100 },
  { name: "Red Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 2 },
  { name: "Green Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 1 },
  { name: "Yellow Food Colour", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 1 },
  { name: "Adrak", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 0 },
  { name: "Lahsun", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: Math.round(0.8 * 1000) },
  { name: "Achar", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "jar", factor: 1, qtyBase: 1 },
  // Onion intentionally omitted — see file header.
  { name: "Frozen Chaap", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 60 * 1000 },
  { name: "Lemon", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 12 },
  { name: "Mushroom", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "tin", factor: 1, qtyBase: 1 },
  { name: "Hara Mirch", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 200 },
  { name: "Ajwain", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 500, qtyBase: 500 },
  { name: "Coal", category: "OTHER", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 25 * 1000 },
  { name: "Kasturi Methi", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 1000 },
  { name: "Simla/Capsicum", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 200 },
  { name: "Curd", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000, qtyBase: 0 },
  { name: "Peri Peri Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100, qtyBase: 0 },
];

const DISPOSABLES: StockLine[] = [
  { name: "White Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 0 },
  { name: "Large Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 13 },
  { name: "Small Plate", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 2 },
  { name: "Large Delivery Box", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 100 },
  { name: "Small Delivery Box", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 100 },
  { name: "Tissue", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 12 },
  { name: "Fork", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 0 },
  { name: "Toothpick", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "set", factor: 1, qtyBase: 1 },
  { name: "Aluminium Foil", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "roll", factor: 1, qtyBase: 0 },
  { name: "Cap", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1, qtyBase: 1 },
  { name: "Carry Bag", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "piece", factor: 1, qtyBase: 50 },
];

const ALL = [...RAW_MATERIALS, ...DISPOSABLES];

async function main() {
  await connectMongo();

  const admin = await User.findOne({ username: "admin" });
  if (!admin) {
    console.error("No admin user found — run `npm run seed` first.");
    process.exit(1);
  }
  const ADMIN = admin._id;

  let created = 0;
  let skippedExisting = 0;

  await withTransaction(async (session) => {
    for (const line of ALL) {
      const existing = await InventoryItem.findOne({ name: line.name }).session(session);
      if (existing) {
        skippedExisting++;
        continue;
      }

      const id = newId("inv");
      await InventoryItem.create(
        [
          {
            _id: id,
            name: line.name,
            category: line.category,
            baseUnit: line.baseUnit,
            purchaseUnit: line.purchaseUnit,
            purchaseToBaseFactor: line.factor,
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

      if (line.qtyBase > 0) {
        await recordMovement(
          {
            inventoryItemId: id,
            movementType: "OPENING_STOCK",
            direction: "IN",
            quantityBase: line.qtyBase,
            unitCostPaisePerBase: null,
            referenceType: "OPENING",
            reason: `Physical stock count, ${BUSINESS_DATE}`,
            businessDate: BUSINESS_DATE,
            userId: ADMIN,
          },
          session
        );
      }
      created++;
    }

    await recordAudit(
      {
        userId: ADMIN,
        action: "STOCK_IMPORTED",
        entityType: "inventory_item",
        newValue: { businessDate: BUSINESS_DATE, itemCount: created, source: "physical count sheet" },
        reason: `Bulk import of physical stock count for ${BUSINESS_DATE}`,
      },
      session
    );
  });

  console.log(`\n✓ Stock count for ${BUSINESS_DATE} imported.`);
  console.log(`  ${created} items created, ${skippedExisting} already existed (skipped).`);
  console.log(`  All items are PRICE PENDING — no costs were given in this count.`);
  console.log(
    `\n⚠ Onion was skipped entirely — sheet gives "12.5kg" but there's no agreed base unit for it yet. Needs a manual decision before it's created.`
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
