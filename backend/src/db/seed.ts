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
import { db } from "./connection";
import { runMigrations } from "./migrate";

// IMPORTANT: migrations must run before ANY other module in this project is
// loaded, because several service modules call db.prepare(...) at module
// top-level (for performance). Under tsx/esbuild, `import` statements are
// hoisted to the top of the file (unlike tsc's commonjs output), so a plain
// `import` placed after this call would still be loaded first and crash
// against a schema that doesn't exist yet on a fresh database. Using
// require() here — a real runtime call, not a hoisted declaration —
// guarantees migrations really do run first.
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const bcrypt = require("bcryptjs") as typeof import("bcryptjs");
const { newId, nowIso } = require("../utils/ids") as typeof import("../utils/ids");
const { env } = require("../config/env") as typeof import("../config/env");
const { setMenuPrice } = require("../modules/menu/menu.service") as typeof import("../modules/menu/menu.service");
/* eslint-enable @typescript-eslint/no-var-requires */

function rupees(r: number): number {
  return Math.round(r * 100);
}

console.log("Seeding Chaap Di Haati RMS...\n");
console.log("This seed loads login accounts, payment methods, the menu, and");
console.log("the staff roster. Inventory, recipes, suppliers, and all");
console.log("transactional data are intentionally left empty — add real data");
console.log("through the app.\n");

// ============================================================
// 1. ROLES + USERS
// ============================================================
const txnBootstrap = db.transaction(() => {
  db.prepare("DELETE FROM roles").run();
  for (const [name, description] of [
    ["ADMIN", "Full access — owner/operator"],
    ["MANAGER", "Day-to-day operations, cannot touch financial history or audit trail"],
    ["STAFF", "Order-taking and kitchen updates only"],
  ]) {
    db.prepare("INSERT INTO roles (name, description) VALUES (?, ?)").run(name, description);
  }

  const users = [
    { username: "admin", password: "Admin@123", fullName: "Restaurant Owner", role: "ADMIN" },
    { username: "manager", password: "Manager@123", fullName: "Shift Manager", role: "MANAGER" },
    { username: "staff", password: "Staff@123", fullName: "Counter Staff", role: "STAFF" },
  ];
  const now = nowIso();
  for (const u of users) {
    db.prepare(
      "INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)"
    ).run(newId("user"), u.username, bcrypt.hashSync(u.password, env.bcryptSaltRounds), u.fullName, u.role, now, now);
  }
});
txnBootstrap();

const ADMIN = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
console.log("✓ Roles + users (admin/manager/staff)");

// ============================================================
// 2. PAYMENT METHODS — exactly what's actually accepted at the counter
// ============================================================
const pmTxn = db.transaction(() => {
  const methods: [string, "CASH" | "ONLINE", number][] = [
    ["Cash", "CASH", 0],
    ["UPI", "ONLINE", 1],
    ["Zomato", "ONLINE", 2],
    ["Swiggy", "ONLINE", 3],
  ];
  for (const [name, type, sort] of methods) {
    db.prepare("INSERT INTO payment_methods (id, name, type, active, sort_order) VALUES (?, ?, ?, 1, ?)").run(
      newId("pm"),
      name,
      type,
      sort
    );
  }
});
pmTxn();
console.log("✓ Payment methods (Cash, UPI, Zomato, Swiggy)");

// ============================================================
// 3. MENU CATEGORIES + ITEMS + PRICES
// Source: printed menu card ("Desi Chaap Di Hatti", BIT Mesra franchise outlet).
// ============================================================
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

const menuTxn = db.transaction(() => {
  let catSort = 0;
  for (const cat of CATEGORIES) {
    const catId = newId("cat");
    db.prepare("INSERT INTO menu_categories (id, name, sort_order, active) VALUES (?, ?, ?, 1)").run(catId, cat.name, catSort++);

    let itemSort = 0;
    for (const item of cat.items) {
      const itemId = newId("menuitem");
      db.prepare(
        `INSERT INTO menu_items (id, category_id, name, has_half, has_full, has_single, unit_label, half_label, full_label, status, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`
      ).run(
        itemId,
        catId,
        item.name,
        item.half != null ? 1 : 0,
        item.full != null ? 1 : 0,
        item.single != null ? 1 : 0,
        item.unit ?? "plate",
        item.halfLabel ?? "Half",
        item.fullLabel ?? "Full",
        itemSort++,
        nowIso()
      );
      if (item.half != null) setMenuPrice(itemId, "HALF", rupees(item.half), ADMIN);
      if (item.full != null) setMenuPrice(itemId, "FULL", rupees(item.full), ADMIN);
      if (item.single != null) setMenuPrice(itemId, "SINGLE", rupees(item.single), ADMIN);
    }
  }
});
menuTxn();
console.log("✓ Menu categories, items and prices (from the printed menu card)");

// ============================================================
// 4. STAFF (payroll roster — separate from login accounts)
// ============================================================
const staffTxn = db.transaction(() => {
  const roster: { fullName: string; roleTitle: string; salaryRupees: number }[] = [
    { fullName: "Manager", roleTitle: "Manager", salaryRupees: 10000 },
    { fullName: "Staff 1", roleTitle: "Staff", salaryRupees: 25000 },
    { fullName: "Staff 2", roleTitle: "Staff", salaryRupees: 14000 },
  ];
  const today = nowIso().slice(0, 10);
  for (const person of roster) {
    db.prepare(
      `INSERT INTO staff (id, full_name, role_title, salary_paise, salary_method, joining_date, active, created_at)
       VALUES (?, ?, ?, ?, 'FIXED_30', ?, 1, ?)`
    ).run(newId("staff"), person.fullName, person.roleTitle, rupees(person.salaryRupees), today, nowIso());
  }
});
staffTxn();
console.log("✓ Staff roster (Manager ₹10,000 · Staff ₹25,000 · Staff ₹14,000 per month)");

console.log("\nSeed complete.\n");
console.log("Login credentials:");
console.log("  Admin:   admin / Admin@123");
console.log("  Manager: manager / Manager@123");
console.log("  Staff:   staff / Staff@123");
