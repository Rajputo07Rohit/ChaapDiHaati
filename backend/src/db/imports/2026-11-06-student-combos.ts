/**
 * "Student Special Combo" offer (BIT Mesra banner): four chaap combos, each
 * Half Plate Chaap + 1 Rumali Roti + 1 ₹20 Cold Drink. The drink is a
 * PICK_ONE add-on (₹0) so the customer app makes the customer choose exactly
 * one, the POS asks staff which one, and the kitchen sees it on the ticket.
 *
 * The combos go on both menus — "Student Combo" (restaurant) and
 * "Stall · Student Combo" (street stall) — so they show whichever mode the
 * customer app is in. It also fills in the missing Beverages photos.
 *
 * Images live in the customer app (customer/public/menu/*.jpg), so deploy
 * that first.
 *
 * Safe to re-run: existing categories/items are reused, prices only change
 * (through setMenuPrice, keeping history) when they differ, add-ons are only
 * rewritten when the drink list differs, and photos are only set where none
 * is set yet.
 *
 * Usage: npx tsx src/db/imports/2026-11-06-student-combos.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { MenuCategory, MenuItem, User } from "../models";
import { createMenuItem, getCurrentPrice, setMenuPrice } from "../../modules/menu/menu.service";
import { newId } from "../../utils/ids";

const COMBO_DRINKS = ["Coca-Cola", "Pepsi", "Sprite", "Thums Up", "Mountain Dew"];

const COMBOS: { name: string; rupees: number; description: string; image: string }[] = [
  { name: "Punjabi Chaap Combo", rupees: 139, description: "Half Plate Punjabi Chaap + 1 Rumali Roti + 1 Cold Drink", image: "combo-punjabi-chaap" },
  { name: "Malai Chaap Combo", rupees: 139, description: "Half Plate Malai Chaap + 1 Rumali Roti + 1 Cold Drink", image: "combo-malai-chaap" },
  { name: "Tikhi Titli Chaap Combo", rupees: 159, description: "Half Plate Tikhi Titli Chaap + 1 Rumali Roti + 1 Cold Drink", image: "combo-tikhi-titli-chaap" },
  {
    name: "Veg Chicken Tikka Chaap Combo",
    rupees: 159,
    description: "Half Plate Veg Chicken Tikka Chaap + 1 Rumali Roti + 1 Cold Drink",
    image: "combo-veg-chicken-tikka-chaap",
  },
];

/** Combos lead each menu: before the restaurant's first category (sort 0) and the stall's (sort 1000). */
const CHANNELS: { name: string; channel: "MAIN" | "STALL"; sortOrder: number }[] = [
  { name: "Student Combo", channel: "MAIN", sortOrder: -1 },
  { name: "Stall · Student Combo", channel: "STALL", sortOrder: 999 },
];

/** Beverages item name (lower-cased, spaces collapsed) → photo in customer/public/menu. */
const BEVERAGE_IMAGES: Record<string, string> = {
  "coco cola": "coca-cola",
  "coca cola": "coca-cola",
  "sugar free coca cola": "coca-cola",
  "sugar free coce": "coca-cola",
  pepsi: "pepsi",
  sprite: "sprite",
  "thums up": "thums-up",
  "mountain dew": "mountain-dew",
  "7 up": "7-up",
  "lahori zeera": "lahori-zeera",
  "water 1l(alpine)": "water",
  "bailwey water": "water",
  mirinda: "mirinda",
  maaza: "maaza",
};

export async function importStudentCombos(adminUserId: string) {
  let created = 0;
  let repriced = 0;
  for (const ch of CHANNELS) {
    let cat = await MenuCategory.findOne({ name: ch.name });
    if (!cat) {
      cat = await MenuCategory.create({ _id: newId("cat"), name: ch.name, sortOrder: ch.sortOrder, active: true, channel: ch.channel });
    }
    for (const [i, combo] of COMBOS.entries()) {
      let doc = await MenuItem.findOne({ categoryId: cat._id, name: combo.name });
      if (!doc) {
        const id = await createMenuItem({ categoryId: cat._id, name: combo.name, hasSingle: true, unitLabel: "combo" });
        doc = (await MenuItem.findById(id))!;
        created++;
      }
      doc.sortOrder = i;
      doc.addonMode = "PICK_ONE";
      if (!doc.description) doc.description = combo.description;
      if (!doc.imageUrl) doc.imageUrl = `/menu/${combo.image}.jpg`;
      const current = doc.addons.filter((a) => a.active).map((a) => `${a.name}:${a.pricePaise}`);
      const wanted = COMBO_DRINKS.map((d) => `${d}:0`);
      if (current.join("|") !== wanted.join("|")) {
        doc.set(
          "addons",
          COMBO_DRINKS.map((d) => ({ _id: newId("addon"), name: d, pricePaise: 0, active: true }))
        );
      }
      await doc.save();

      const pricePaise = combo.rupees * 100;
      if ((await getCurrentPrice(doc._id, "SINGLE")) !== pricePaise) {
        await setMenuPrice(doc._id, "SINGLE", pricePaise, adminUserId);
        repriced++;
      }
    }
  }

  let photos = 0;
  const bev = await MenuCategory.findOne({ name: "Beverages" });
  if (bev) {
    for (const item of await MenuItem.find({ categoryId: bev._id })) {
      const key = item.name.toLowerCase().replace(/\s+/g, " ").trim();
      const image = BEVERAGE_IMAGES[key];
      if (image && !item.imageUrl) {
        item.imageUrl = `/menu/${image}.jpg`;
        await item.save();
        photos++;
      }
    }
  }
  return { created, repriced, photos };
}

async function main() {
  await connectMongo();
  const admin = await User.findOne({ role: "ADMIN" }).sort({ createdAt: 1 });
  if (!admin) throw new Error("No ADMIN user found — run the seed first.");
  const r = await importStudentCombos(admin._id);
  console.log(`✓ Student combos: ${r.created} items created, ${r.repriced} prices set; ${r.photos} beverage photos added.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
