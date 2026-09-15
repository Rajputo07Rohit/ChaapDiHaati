/**
 * Seed script for Chaap Di Haati RMS.
 *
 * Seeds only what's needed to start using the app for real: the three login
 * accounts, the payment methods actually used at the counter, the current
 * menu (from the printed menu card), and the current staff roster.
 * Inventory items, recipes, suppliers, and all transaction history are
 * deliberately NOT seeded here — that is real business data and must come
 * from the restaurant's actual records, entered through the app (Inventory,
 * Recipes, Purchases, etc.), not invented or hardcoded.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectMongo } from "./mongoose";
import { newId, nowIso } from "../utils/ids";
import { env } from "../config/env";
import { User, PaymentMethod, MenuCategory, MenuItem, Staff } from "./models";
import { setMenuPrice } from "../modules/menu/menu.service";

function rupees(r: number): number {
  return Math.round(r * 100);
}

type ItemDef = {
  name: string;
  half?: number;
  full?: number;
  single?: number;
  unit?: string;
  halfLabel?: string;
  fullLabel?: string;
};

const CATEGORIES: { name: string; items: ItemDef[] }[] = [
  {
    // "SOYA TANDOORI" on the menu card — soya chaap, sold half/full plate.
    name: "Soya Tandoori (Chaap)",
    items: [
      { name: "Malai Chaap", half: 120, full: 190 },
      { name: "Punjabi Chaap", half: 120, full: 190 },
      { name: "Chatpata Chaap", half: 120, full: 190 },
      { name: "Aachari Chaap", half: 130, full: 200 },
      { name: "Afghani Chaap", half: 130, full: 200 },
      { name: "Garlic Chaap", half: 130, full: 200 },
      { name: "Lemon Chaap", half: 130, full: 200 },
      { name: "Mint Pudina Chaap", half: 130, full: 200 },
      { name: "Tikhi Titli", half: 140, full: 210 },
      { name: "Makhmali Chaap", half: 140, full: 210 },
      { name: "Veg Tandoori Leg Pc.", half: 140, full: 210 },
      { name: "Peri Peri Chaap", half: 140, full: 210 },
      { name: "Black Pepper Chaap", half: 140, full: 210 },
      { name: "Hari Mirch Chaap", half: 140, full: 210 },
      { name: "Veg Chicken Tikka Chaap", half: 140, full: 210 },
      { name: "Veg Lemon Chicken Tikka Chaap", half: 150, full: 220 },
      { name: "Masala Stuffed Chaap", half: 150, full: 220 },
      { name: "Desi Chaap Di Hatti Platter", full: 300 },
    ],
  },
  {
    // "PANEER TANDOORI" — single size only on the menu card.
    name: "Paneer Tandoori",
    items: [
      { name: "Paneer Tikka [Dry]", single: 200 },
      { name: "Malai Paneer Tikka", single: 210 },
      { name: "Punjabi Paneer Tikka", single: 220 },
      { name: "Afghani Paneer Tikka", single: 220 },
      { name: "Hariyali Paneer Tikka", single: 220 },
      { name: "Garlic Paneer Tikka", single: 230 },
      { name: "Achari Paneer Tikka", single: 230 },
      { name: "Lemon Paneer Tikka", single: 230 },
      { name: "Peri Peri Paneer Tikka", single: 230 },
    ],
  },
  {
    // "MUSHROOM TANDOORI" — single size only.
    name: "Mushroom Tandoori",
    items: [
      { name: "Mushroom Tikka", single: 200 },
      { name: "Mushroom Malai Tikka", single: 210 },
      { name: "Afghani Mushroom Tikka", single: 220 },
      { name: "Hariyali Mushroom Tikka", single: 220 },
      { name: "Garlic Mushroom Tikka", single: 230 },
      { name: "Achari Mushroom Tikka", single: 230 },
      { name: "Peri Peri Mushroom Tikka", single: 230 },
    ],
  },
  {
    // Momo sells in two piece-counts, not portion sizes — HALF/FULL price
    // slots are reused for 5pc/8pc, with labels overridden accordingly.
    name: "Momo",
    items: [
      { name: "Veg Tandoori Momo", half: 100, full: 160, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Veg Malai Momo", half: 110, full: 170, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Veg Afghani Momo", half: 110, full: 170, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Veg Achari Momo", half: 110, full: 170, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Veg Peri Peri Momo", half: 120, full: 180, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Paneer Tandoori Momo", half: 110, full: 170, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Paneer Malai Momo", half: 120, full: 180, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Paneer Afghani Momo", half: 120, full: 180, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Paneer Achari Momo", half: 120, full: 180, halfLabel: "5 pc", fullLabel: "8 pc" },
      { name: "Paneer Peri Peri Momo", half: 130, full: 190, halfLabel: "5 pc", fullLabel: "8 pc" },
    ],
  },
  {
    // "SOYACHAAP ROLLS" — single size only.
    name: "Chaap Rolls",
    items: [
      { name: "Malai Chaap Roll", single: 100 },
      { name: "Punjabi Chaap Roll", single: 100 },
      { name: "Chatpata Chaap Roll", single: 100 },
      { name: "Afghani Chaap Roll", single: 110 },
      { name: "Achari Chaap Roll", single: 110 },
      { name: "Garlic Chaap Roll", single: 110 },
      { name: "Lemon Chaap Roll", single: 110 },
      { name: "Hariyali Chaap Roll", single: 120 },
      { name: "Tikhi Titli Chaap Roll", single: 120 },
      { name: "Makhmali Chaap Roll", single: 120 },
      { name: "Black Pepper Chaap Roll", single: 120 },
      { name: "Hari Mirch Chaap Roll", single: 120 },
      { name: "Veg Chicken Tikka Chaap Roll", single: 120 },
      { name: "Veg Lemon Chicken Tikka Chaap Roll", single: 130 },
      { name: "Peri Peri Chaap Roll", single: 120 },
    ],
  },
  {
    // "PANEER TIKKA ROLLS" — single size only.
    name: "Paneer Tikka Rolls",
    items: [
      { name: "Paneer Tikka Roll", single: 120 },
      { name: "Malai Paneer Tikka Roll", single: 130 },
      { name: "Afghani Paneer Tikka Roll", single: 130 },
      { name: "Hariyali Paneer Tikka Roll", single: 130 },
      { name: "Garlic Paneer Tikka Roll", single: 130 },
      { name: "Achari Paneer Tikka Roll", single: 130 },
      { name: "Lemon Paneer Tikka Roll", single: 130 },
      { name: "Peri Peri Paneer Tikka Roll", single: 130 },
    ],
  },
  {
    name: "Breads",
    items: [
      { name: "Rumali Roti", single: 20 },
      { name: "Butter Rumali Roti", single: 30 },
    ],
  },
  {
    // Add-ons printed on the menu card ("Add EXTRA CREAM/CHEESE — Rs 10
    // only"). Added to an order as their own line next to the dish they
    // top up, since there's no per-line modifier system.
    name: "Extras",
    items: [
      { name: "Extra Cream", single: 10 },
      { name: "Extra Cheese", single: 10 },
    ],
  },
];

async function main() {
  await connectMongo();

  console.log("Seeding Chaap Di Haati RMS...\n");
  console.log("This seed loads login accounts, payment methods, the menu, and");
  console.log("the staff roster. Inventory, recipes, suppliers, and all");
  console.log("transactional data are intentionally left empty — add real data");
  console.log("through the app.\n");

  // ============================================================
  // 1. USERS
  // ============================================================
  const now = nowIso();
  const users = [
    { username: "admin", password: "Admin@123", fullName: "Restaurant Owner", role: "ADMIN" as const },
    { username: "manager", password: "Manager@123", fullName: "Shift Manager", role: "MANAGER" as const },
    { username: "staff", password: "Staff@123", fullName: "Counter Staff", role: "STAFF" as const },
  ];
  let adminId = "";
  for (const u of users) {
    const id = newId("user");
    if (u.role === "ADMIN") adminId = id;
    await User.create({
      _id: id,
      username: u.username,
      passwordHash: bcrypt.hashSync(u.password, env.bcryptSaltRounds),
      fullName: u.fullName,
      role: u.role,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  console.log("✓ Users (admin/manager/staff)");

  // ============================================================
  // 2. PAYMENT METHODS — exactly what's actually accepted at the counter
  // ============================================================
  const methods: [string, "CASH" | "ONLINE", number][] = [
    ["Cash", "CASH", 0],
    ["UPI", "ONLINE", 1],
    ["Zomato", "ONLINE", 2],
    ["Swiggy", "ONLINE", 3],
  ];
  for (const [name, type, sort] of methods) {
    await PaymentMethod.create({ _id: newId("pm"), name, type, active: true, sortOrder: sort });
  }
  console.log("✓ Payment methods (Cash, UPI, Zomato, Swiggy)");

  // ============================================================
  // 3. MENU CATEGORIES + ITEMS + PRICES
  // Source: printed menu card ("Desi Chaap Di Hatti", BIT Mesra franchise outlet).
  // ============================================================
  let catSort = 0;
  for (const cat of CATEGORIES) {
    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: cat.name, sortOrder: catSort++, active: true });

    let itemSort = 0;
    for (const item of cat.items) {
      const itemId = newId("menuitem");
      await MenuItem.create({
        _id: itemId,
        categoryId: catId,
        name: item.name,
        hasHalf: item.half != null,
        hasFull: item.full != null,
        hasSingle: item.single != null,
        unitLabel: item.unit ?? "plate",
        halfLabel: item.halfLabel ?? "Half",
        fullLabel: item.fullLabel ?? "Full",
        status: "ACTIVE",
        sortOrder: itemSort++,
        createdAt: now,
      });
      if (item.half != null) await setMenuPrice(itemId, "HALF", rupees(item.half), adminId);
      if (item.full != null) await setMenuPrice(itemId, "FULL", rupees(item.full), adminId);
      if (item.single != null) await setMenuPrice(itemId, "SINGLE", rupees(item.single), adminId);
    }
  }
  console.log("✓ Menu categories, items and prices (from the printed menu card)");

  // ============================================================
  // 4. STAFF (payroll roster — separate from login accounts)
  // ============================================================
  const roster: { fullName: string; roleTitle: string; salaryRupees: number }[] = [
    { fullName: "Manager", roleTitle: "Manager", salaryRupees: 10000 },
    { fullName: "Staff 1", roleTitle: "Staff", salaryRupees: 25000 },
    { fullName: "Staff 2", roleTitle: "Staff", salaryRupees: 14000 },
  ];
  const today = nowIso().slice(0, 10);
  for (const person of roster) {
    await Staff.create({
      _id: newId("staff"),
      fullName: person.fullName,
      roleTitle: person.roleTitle,
      salaryPaise: rupees(person.salaryRupees),
      salaryMethod: "FIXED_30",
      joiningDate: today,
      active: true,
      createdAt: nowIso(),
    });
  }
  console.log("✓ Staff roster (Manager ₹10,000 · Staff ₹25,000 · Staff ₹14,000 per month)");

  console.log("\nSeed complete.\n");
  console.log("Login credentials:");
  console.log("  Admin:   admin / Admin@123");
  console.log("  Manager: manager / Manager@123");
  console.log("  Staff:   staff / Staff@123");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
