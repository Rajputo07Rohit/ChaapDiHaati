/**
 * Creates the street-stall menu ("Desi Chaap Di Hatti" stall board): its own
 * categories with channel STALL, one "Portion" (SINGLE) price per item. The
 * customer app shows this menu only while an admin has switched stall
 * dine-in or stall delivery on (Settings → Store hours → Stall ordering).
 *
 * Safe to re-run: existing stall categories/items are reused, and a price is
 * only changed (through setMenuPrice, so history is kept) when it differs.
 *
 * Usage: npx tsx src/db/imports/2026-10-31-stall-menu.ts
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectMongo } from "../mongoose";
import { MenuCategory, MenuItem, User } from "../models";
import { createMenuItem, getCurrentPrice, setMenuPrice } from "../../modules/menu/menu.service";
import { newId } from "../../utils/ids";

type StallItem = { name: string; rupees: number; image?: string };

/** Category names carry a "Stall · " prefix because category names are unique across both menus; the customer app hides the prefix. */
export const STALL_PREFIX = "Stall · ";

const STALL_MENU: { category: string; items: StallItem[] }[] = [
  {
    category: "Soya Tandoori",
    items: [
      { name: "Malai Chaap", rupees: 130, image: "malai-chaap" },
      { name: "Punjabi Chaap", rupees: 130, image: "punjabi-chaap" },
      { name: "Chatpata Chaap", rupees: 130 },
      { name: "Achari Chaap", rupees: 140, image: "aachari-chaap" },
      { name: "Afghani Chaap", rupees: 140, image: "afghani-chaap" },
      { name: "Garlic Chaap", rupees: 140, image: "garlic-lemon-chaap" },
      { name: "Lemon Chaap", rupees: 140 },
      { name: "Tikkhi Titli Chaap", rupees: 150, image: "tikhi-titli" },
      { name: "Makhmali Chaap", rupees: 150, image: "makhmali-chaap" },
      { name: "Veg Tandoori Leg Piece", rupees: 150, image: "veg-tandoori-leg-pc" },
      { name: "Peri Peri Chaap", rupees: 150, image: "peri-peri-chaap" },
      { name: "Black Pepper Chaap", rupees: 150 },
      { name: "Hari Mirch Chaap", rupees: 150, image: "hari-mirch-chaap" },
      { name: "Hariyali Chaap", rupees: 150, image: "mint-pudina-chaap" },
      { name: "Veg Chicken Tikka Chaap", rupees: 150 },
      { name: "Veg Lemon Chicken Tikka Chaap", rupees: 160 },
      { name: "Masala Stuffed Chaap", rupees: 160, image: "masala-stuffed-chaap" },
    ],
  },
  {
    category: "Paneer Tandoori",
    items: [
      { name: "Paneer Tikka (Dry)", rupees: 210, image: "paneer-tikka-dry" },
      { name: "Malai Paneer Tikka", rupees: 220, image: "malai-paneer-tikka" },
      { name: "Punjabi Paneer Tikka", rupees: 230, image: "punjabi-paneer-tikka" },
      { name: "Afghani Paneer Tikka", rupees: 230, image: "afghani-paneer-tikka" },
      { name: "Hariyali Paneer Tikka", rupees: 230, image: "hariyali-paneer-tikka" },
      { name: "Garlic Paneer Tikka", rupees: 240, image: "garlic-paneer-tikka" },
      { name: "Achari Paneer Tikka", rupees: 240, image: "achari-paneer-tikka" },
      { name: "Lemon Paneer Tikka", rupees: 240 },
      { name: "Peri Peri Paneer Tikka", rupees: 240 },
    ],
  },
  {
    category: "Mushroom Tandoori",
    items: [
      { name: "Mushroom Tikka", rupees: 210 },
      { name: "Mushroom Malai Tikka", rupees: 220, image: "mushroom-malai-tikka" },
      { name: "Afghani Mushroom Tikka", rupees: 230, image: "afghani-mushroom-tikka" },
      { name: "Hariyali Mushroom Tikka", rupees: 230, image: "hariyali-mushroom-tikka" },
      { name: "Garlic Mushroom Tikka", rupees: 240 },
      { name: "Achari Mushroom Tikka", rupees: 240, image: "achari-mushroom-tikka" },
      { name: "Peri Peri Mushroom Tikka", rupees: 240 },
    ],
  },
  {
    category: "Veg Tandoori Momos",
    items: [
      { name: "Veg Tandoori Momos", rupees: 100, image: "veg-tandoori-momo" },
      { name: "Veg Malai Momos", rupees: 110 },
      { name: "Veg Afghani Momos", rupees: 110, image: "veg-afghani-momo" },
      { name: "Veg Achari Momos", rupees: 110 },
      { name: "Veg Peri Peri Momos", rupees: 120, image: "veg-peri-peri-momo" },
    ],
  },
  {
    category: "Paneer Tandoori Momos",
    items: [
      { name: "Paneer Tandoori Momos", rupees: 110, image: "paneer-tandoori-momo" },
      { name: "Paneer Malai Momos", rupees: 120 },
      { name: "Paneer Afghani Momos", rupees: 120 },
      { name: "Paneer Achari Momos", rupees: 120 },
      { name: "Paneer Peri Peri Momos", rupees: 130 },
    ],
  },
  {
    category: "Breads",
    items: [{ name: "Rumali Roti", rupees: 25, image: "rumali-roti" }],
  },
  {
    // Named "Extras" so the customer cart offers them as "+ Add extra" on each stall dish.
    category: "Extras",
    items: [
      { name: "Extra Cream", rupees: 10 },
      { name: "Extra Cheese", rupees: 10 },
    ],
  },
];

/** Stall categories sort after the restaurant ones in staff screens (POS, Menu). */
const SORT_BASE = 1000;

export async function importStallMenu(adminUserId: string): Promise<{ created: number; repriced: number }> {
  let created = 0;
  let repriced = 0;
  for (const [ci, section] of STALL_MENU.entries()) {
    const name = `${STALL_PREFIX}${section.category}`;
    let cat = await MenuCategory.findOne({ name });
    if (!cat) {
      cat = await MenuCategory.create({ _id: newId("cat"), name, sortOrder: SORT_BASE + ci, active: true, channel: "STALL" });
    } else if (cat.channel !== "STALL") {
      cat.channel = "STALL";
      await cat.save();
    }

    for (const [ii, item] of section.items.entries()) {
      let doc = await MenuItem.findOne({ categoryId: cat._id, name: item.name });
      if (!doc) {
        const id = await createMenuItem({ categoryId: cat._id, name: item.name, hasSingle: true, unitLabel: "portion" });
        doc = (await MenuItem.findById(id))!;
        created++;
      }
      doc.sortOrder = ii;
      if (item.image && !doc.imageUrl) doc.imageUrl = `/menu/${item.image}.jpg`;
      await doc.save();

      const pricePaise = item.rupees * 100;
      if ((await getCurrentPrice(doc._id, "SINGLE")) !== pricePaise) {
        await setMenuPrice(doc._id, "SINGLE", pricePaise, adminUserId);
        repriced++;
      }
    }
  }
  return { created, repriced };
}

async function main() {
  await connectMongo();
  const admin = await User.findOne({ role: "ADMIN" }).sort({ createdAt: 1 });
  if (!admin) throw new Error("No ADMIN user found — run the seed first.");
  const { created, repriced } = await importStallMenu(admin._id);
  console.log(`✓ Stall menu: ${created} items created, ${repriced} prices set.`);
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
