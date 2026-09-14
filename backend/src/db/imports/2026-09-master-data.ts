/**
 * One-time import of the owner's paper/register records for 4–14 Sept 2026:
 * confirmed cost prices, purchase bills, expenses, bank transactions, daily
 * sales totals, and the 14-Sept physical stock count.
 *
 * This runs through the real service layer (recordPurchase, recordExpense,
 * recordCashTransaction, recordBankTransaction, recordMovement) — the same
 * code paths the UI uses — so every entry gets proper cost averaging, cash/
 * bank ledger postings, and audit trail, exactly like the 12-Sept stock
 * count import before it.
 *
 * Accounting rules followed (see owner's master data notes):
 *  - Purchases increase inventory; they are NOT auto-counted as COGS.
 *  - COGS needs recipes/BOM, which do not exist yet beyond the raw-chaap
 *    yield — so daily_closings.cogs/gross_profit/net_profit are left NULL
 *    for every historical day rather than guessed. Once recipes are entered,
 *    a follow-up pass can compute these.
 *  - Reported figures are preserved as given, even where they don't
 *    internally reconcile — discrepancies are recorded in notes, not
 *    silently corrected.
 *  - Unknown/ambiguous bank transactions are stored with reconciled=0 and
 *    category UNKNOWN/PERSONAL (best guess) for the owner to review later.
 *
 * Idempotent-ish: safe to re-run for inventory item creation and cost
 * overrides (skips existing), but purchases/expenses/cash/bank rows are
 * plain inserts — do NOT re-run after a successful first run, or these will
 * be duplicated. Usage: npx tsx src/db/imports/2026-09-master-data.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";

runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { newId, nowIso } = require("../../utils/ids") as typeof import("../../utils/ids");
const { recordMovement } = require("../../modules/inventory/inventory.service") as typeof import("../../modules/inventory/inventory.service");
const { recordAudit } = require("../../utils/audit") as typeof import("../../utils/audit");
const { recordPurchase } = require("../../modules/purchases/purchases.service") as typeof import("../../modules/purchases/purchases.service");
const { recordExpense } = require("../../modules/expenses/expenses.service") as typeof import("../../modules/expenses/expenses.service");
const { recordCashTransaction } = require("../../modules/cash/cash.service") as typeof import("../../modules/cash/cash.service");
const { recordBankTransaction, getBankBalancePaise } = require("../../modules/bank/bank.service") as typeof import("../../modules/bank/bank.service");
/* eslint-enable @typescript-eslint/no-var-requires */

const ADMIN_ROLE = "ADMIN" as const;
const rupees = (r: number) => Math.round(r * 100);

const admin = db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string } | undefined;
if (!admin) {
  console.error("No admin user found — run `npm run seed` first.");
  process.exit(1);
}
const ADMIN = admin.id;

const CASH = (db.prepare("SELECT id FROM payment_methods WHERE name = 'Cash'").get() as { id: string }).id;
const UPI = (db.prepare("SELECT id FROM payment_methods WHERE name = 'UPI'").get() as { id: string }).id;

function itemId(name: string): string {
  const row = db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(name) as { id: string } | undefined;
  if (!row) throw new Error(`Inventory item not found: ${name}`);
  return row.id;
}

// ============================================================
// 1. New inventory items not covered by the earlier stock-count import
// ============================================================
interface NewItem {
  name: string;
  category: "RAW_MATERIAL" | "DISPOSABLE" | "OTHER";
  baseUnit: "g" | "ml" | "piece";
  purchaseUnit: string;
  factor: number;
}
const NEW_ITEMS: NewItem[] = [
  { name: "Paneer", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000 },
  { name: "Butter", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "kg", factor: 1000 },
  { name: "Rumali", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1 },
  { name: "Butter Rumali", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "piece", factor: 1 },
  { name: "Veg Momo", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "plate", factor: 1 },
  { name: "Paneer Momo", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "plate", factor: 1 },
  { name: "Mutton Masala", category: "RAW_MATERIAL", baseUnit: "g", purchaseUnit: "packet", factor: 100 },
  { name: "Peri Peri Masala", category: "RAW_MATERIAL", baseUnit: "piece", purchaseUnit: "packet", factor: 1 },
  // Multiple distinct container sizes were purchased (half/chhota/bada,
  // 500ml/750ml black) but never re-identified individually elsewhere —
  // tracked as one generic reusable-container line, size noted per purchase line.
  { name: "Storage Container", category: "OTHER", baseUnit: "piece", purchaseUnit: "piece", factor: 1 },
  { name: "Chutney Packing", category: "DISPOSABLE", baseUnit: "piece", purchaseUnit: "packet", factor: 1 },
];

let itemsCreated = 0;
for (const it of NEW_ITEMS) {
  const existing = db.prepare("SELECT id FROM inventory_items WHERE name = ?").get(it.name);
  if (existing) continue;
  db.prepare(
    `INSERT INTO inventory_items
      (id, name, category, base_unit, purchase_unit, purchase_to_base_factor, current_qty_base,
       min_stock_base, reorder_level_base, avg_cost_paise_per_base, price_pending, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 1, 1, ?)`
  ).run(newId("inv"), it.name, it.category, it.baseUnit, it.purchaseUnit, it.factor, nowIso());
  itemsCreated++;
}

// ============================================================
// 2. Confirmed cost prices for items with NO matching purchase-bill line
//    (Capsicum and Lal Mirch Powder never appear on any itemised bill;
//     Butter Rumali's per-piece cost was only ever given as a reference
//     price, never an actual purchase quantity).
// ============================================================
const MANUAL_COSTS: { name: string; paisePerBase: number }[] = [
  { name: "Simla/Capsicum", paisePerBase: rupees(50) / 1000 }, // ₹50/kg
  { name: "Lal Mirch Powder", paisePerBase: rupees(270) / 1000 }, // ₹270/kg
  { name: "Butter Rumali", paisePerBase: rupees(12) }, // ₹12/pc
];
for (const c of MANUAL_COSTS) {
  db.prepare("UPDATE inventory_items SET avg_cost_paise_per_base = ?, price_pending = 0 WHERE name = ?").run(
    c.paisePerBase,
    c.name
  );
}
recordAudit({
  userId: ADMIN,
  action: "COST_CONFIRMED",
  entityType: "inventory_item",
  newValue: { items: MANUAL_COSTS, source: "owner-confirmed reference prices, no matching purchase bill" },
  reason: "Bulk import of confirmed cost prices without a corresponding dated purchase",
});

// ============================================================
// 3. Supplier
// ============================================================
let desiChaap = db.prepare("SELECT id FROM suppliers WHERE name = 'Desi Chaap'").get() as { id: string } | undefined;
if (!desiChaap) {
  const id = newId("sup");
  db.prepare("INSERT INTO suppliers (id, name, active, created_at) VALUES (?, 'Desi Chaap', 1, ?)").run(id, nowIso());
  desiChaap = { id };
}
const DESI_CHAAP = desiChaap.id;

// ============================================================
// 4. Bank opening balance (04 Sept 2026)
// ============================================================
const hasOpening = db.prepare("SELECT 1 FROM settings WHERE key = 'bank_opening_balance_paise'").get();
if (!hasOpening) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('bank_opening_balance_paise', ?)").run(
    JSON.stringify(rupees(5253.21))
  );
}

// ============================================================
// 5. Dated, fully-itemised purchase bills — recorded via recordPurchase(),
//    which auto-posts the matching cash/bank debit and updates weighted-
//    average cost on every line.
// ============================================================
interface PLine {
  name: string;
  qty: number;
  unit: string;
  ratePaise: number;
  notes?: string;
}
function purchase(
  businessDate: string,
  lines: PLine[],
  opts: { paymentStatus: "PAID" | "CREDIT"; paymentMethodId?: string; notes?: string; invoiceNumber?: string } = {
    paymentStatus: "PAID",
  }
) {
  recordPurchase(
    {
      supplierId: DESI_CHAAP,
      businessDate,
      paymentMethodId: opts.paymentMethodId,
      paymentStatus: opts.paymentStatus,
      items: lines.map((l) => ({
        inventoryItemId: itemId(l.name),
        quantity: l.qty,
        purchaseUnit: l.unit,
        ratePaise: l.ratePaise,
        notes: l.notes,
      })),
      notes: opts.notes,
    },
    ADMIN,
    ADMIN_ROLE
  );
}

// 06-Sept purchase bill (₹5,172) — dated 07-Sept to match the confirmed
// ₹5,172 "Desi Chaap" bank debit on 07 Sept; goods were listed under the
// "06 Sept" heading in source notes.
purchase(
  "2026-09-07",
  [
    { name: "Rumali", qty: 150, unit: "piece", ratePaise: rupees(10) },
    { name: "Storage Container", qty: 1, unit: "piece", ratePaise: rupees(240), notes: "Half container" },
    { name: "Degi Mirch", qty: 1, unit: "packet", ratePaise: rupees(115) },
    { name: "Small Plate", qty: 10, unit: "packet", ratePaise: rupees(10), notes: "Chota plate" },
    { name: "Fork", qty: 2, unit: "piece", ratePaise: rupees(45) },
    { name: "Tissue", qty: 10, unit: "packet", ratePaise: rupees(12) },
    { name: "Cap", qty: 1, unit: "packet", ratePaise: rupees(65), notes: "Hair cap" },
    { name: "Paneer", qty: 1, unit: "kg", ratePaise: rupees(300) },
    { name: "Paneer Momo", qty: 10, unit: "plate", ratePaise: rupees(40) },
    { name: "Aluminium Foil", qty: 1, unit: "roll", ratePaise: rupees(400), notes: "Silver foil" },
    { name: "Coal", qty: 30.7, unit: "kg", ratePaise: rupees(60) },
  ],
  { paymentStatus: "PAID", paymentMethodId: UPI, notes: "Listed as '06 Sept purchase' in source notes; dated to match confirmed 07-Sept bank debit of ₹5,172." }
);

// 09-Sept purchase (bill 1 + bill 2, ₹8,995 total) — matches confirmed
// ₹8,995 "Desi Chaap" bank debit on 09 Sept.
purchase(
  "2026-09-09",
  [
    { name: "Large Plate", qty: 5, unit: "packet", ratePaise: rupees(30), notes: "Bada plate — bill 1" },
    { name: "Fork", qty: 2, unit: "piece", ratePaise: rupees(45), notes: "bill 1" },
    { name: "Butter", qty: 10, unit: "kg", ratePaise: rupees(220), notes: "bill 1" },
    { name: "Carry Bag", qty: 1, unit: "packet", ratePaise: rupees(180), notes: "Chota carry bag — bill 1" },
    { name: "Chutney Packing", qty: 1, unit: "packet", ratePaise: rupees(35), notes: "bill 1" },
    { name: "Paneer Momo", qty: 5, unit: "plate", ratePaise: rupees(40), notes: "bill 1" },
    { name: "Veg Momo", qty: 5, unit: "plate", ratePaise: rupees(32), notes: "bill 1" },
    { name: "Paneer", qty: 1, unit: "kg", ratePaise: rupees(300), notes: "bill 1" },
    { name: "Rumali", qty: 150, unit: "piece", ratePaise: rupees(10), notes: "bill 1" },
    { name: "Rumali", qty: 150, unit: "piece", ratePaise: rupees(10), notes: "bill 2" },
    { name: "Paneer", qty: 1, unit: "kg", ratePaise: rupees(300), notes: "bill 2" },
    { name: "Storage Container", qty: 1, unit: "piece", ratePaise: rupees(340), notes: "Bada container — bill 2" },
    { name: "Storage Container", qty: 1, unit: "piece", ratePaise: rupees(250), notes: "Black container 500ml — bill 2" },
    { name: "Storage Container", qty: 1, unit: "piece", ratePaise: rupees(380), notes: "Black container 750ml — bill 2" },
    { name: "Cream", qty: 6, unit: "packet", ratePaise: rupees(235), notes: "Amul Cream 6 pcs — bill 2" },
  ],
  { paymentStatus: "PAID", paymentMethodId: UPI }
);

// 11-Sept purchase (₹13,710) — no bank confirmation in the given data range;
// method inferred from the recurring Desi Chaap/UPI pattern.
purchase(
  "2026-09-11",
  [
    { name: "Frozen Chaap", qty: 50, unit: "kg", ratePaise: rupees(105) },
    { name: "Coal", qty: 20, unit: "kg", ratePaise: rupees(60), notes: "Koyla" },
    { name: "Paneer Momo", qty: 5, unit: "plate", ratePaise: rupees(40) },
    { name: "Veg Momo", qty: 5, unit: "plate", ratePaise: rupees(32) },
    { name: "Paneer", qty: 1, unit: "kg", ratePaise: rupees(300) },
    { name: "Butter", qty: 5, unit: "kg", ratePaise: rupees(220) },
    { name: "Cream", qty: 12, unit: "packet", ratePaise: rupees(235), notes: "Amul cream 1 peti (12 pcs)" },
    { name: "Small Plate", qty: 10, unit: "packet", ratePaise: rupees(10), notes: "Chhota plate" },
    { name: "Large Plate", qty: 5, unit: "packet", ratePaise: rupees(30), notes: "Bada plate" },
    { name: "Storage Container", qty: 1, unit: "piece", ratePaise: rupees(240), notes: "Chhota container" },
    { name: "Fork", qty: 2, unit: "piece", ratePaise: rupees(45), notes: "Kanta chammach" },
    { name: "Rumali", qty: 150, unit: "piece", ratePaise: rupees(10) },
    { name: "Garam Masala", qty: 2, unit: "packet", ratePaise: rupees(100) },
    { name: "Kitchen King Masala", qty: 2, unit: "packet", ratePaise: rupees(85) },
    { name: "Degi Mirch", qty: 2, unit: "packet", ratePaise: rupees(115) },
  ],
  {
    paymentStatus: "PAID",
    paymentMethodId: UPI,
    notes:
      "Source notes later cite a corrected Cream figure of ₹2,840 for 12 pkt (₹236.67/pkt) vs the ₹2,820 recorded here (₹235/pkt) — kept as originally itemised per reconciliation policy. Flagged discrepancy: ₹20.",
  }
);

// 12-Sept purchase (bill 1 + bill 2, ₹11,010 total)
purchase(
  "2026-09-12",
  [
    { name: "Rumali", qty: 50, unit: "piece", ratePaise: rupees(10), notes: "bill 1" },
    { name: "Fork", qty: 2, unit: "piece", ratePaise: rupees(45), notes: "bill 1" },
    { name: "Large Plate", qty: 5, unit: "packet", ratePaise: rupees(30), notes: "Badi plate — bill 1" },
    { name: "Rumali", qty: 200, unit: "piece", ratePaise: rupees(10), notes: "bill 2" },
    { name: "Frozen Chaap", qty: 50, unit: "kg", ratePaise: rupees(105), notes: "bill 2" },
    { name: "Coal", qty: 40, unit: "kg", ratePaise: rupees(60), notes: "Koyla — bill 2" },
    { name: "Veg Momo", qty: 5, unit: "plate", ratePaise: rupees(32), notes: "bill 2" },
    { name: "Paneer Momo", qty: 5, unit: "plate", ratePaise: rupees(40), notes: "bill 2" },
    { name: "Small Plate", qty: 10, unit: "packet", ratePaise: rupees(10), notes: "Chota plate — bill 2" },
    { name: "Fork", qty: 2, unit: "piece", ratePaise: rupees(45), notes: "bill 2" },
    { name: "Chutney Packing", qty: 2, unit: "packet", ratePaise: rupees(35), notes: "bill 2" },
  ],
  { paymentStatus: "PAID", paymentMethodId: UPI }
);

// Undated bulk oil + masala batch — no matching bank entry, kept unpaid/CREDIT
// rather than guessing a settlement date/method.
purchase(
  "2026-09-04",
  [
    { name: "Refined Oil", qty: 15, unit: "kg", ratePaise: Math.round(rupees(2300) / 15) },
    { name: "Sarso Oil", qty: 1, unit: "kg", ratePaise: rupees(185) },
    { name: "Degi Mirch", qty: 10, unit: "packet", ratePaise: rupees(104) },
    { name: "Garam Masala", qty: 10, unit: "packet", ratePaise: rupees(104) },
    { name: "Chicken Masala", qty: 3, unit: "packet", ratePaise: rupees(85) },
    { name: "Mutton Masala", qty: 3, unit: "packet", ratePaise: Math.round(rupees(245) / 3) },
  ],
  {
    paymentStatus: "CREDIT",
    notes:
      "DATE PENDING — no purchase date was given for this batch in source notes; defaulted to the business opening date (04 Sept). Payment method/date also not given, so recorded as unpaid (CREDIT) rather than guessed, to avoid inventing a bank/cash movement that didn't happen on a confirmed date.",
  }
);

// ============================================================
// 6. Expenses
// ============================================================
interface ELine {
  date: string;
  category: string;
  description: string;
  amountRupees: number;
  method: string;
}
const EXPENSES: ELine[] = [
  // 05 Sept — individual lines sum to ₹1,972 vs reported ₹1,712 (flagged in daily_closings notes)
  { date: "2026-09-05", category: "Vegetables", description: "Simla (capsicum)", amountRupees: 160, method: CASH },
  { date: "2026-09-05", category: "Cleaning", description: "Grass broom", amountRupees: 99, method: UPI },
  { date: "2026-09-05", category: "Cleaning", description: "Clip mop", amountRupees: 298, method: UPI },
  { date: "2026-09-05", category: "Cleaning", description: "Floor cleaner", amountRupees: 125, method: UPI },
  { date: "2026-09-05", category: "Cleaning", description: "Wiper", amountRupees: 498, method: UPI },
  { date: "2026-09-05", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 292, method: CASH },
  { date: "2026-09-05", category: "Repair", description: "Electrician", amountRupees: 500, method: CASH },
  // 06 Sept — individual lines sum to ₹8,363 vs reported ₹8,331 (flagged)
  { date: "2026-09-06", category: "Miscellaneous", description: "Miscellaneous + chain", amountRupees: 4191, method: CASH },
  { date: "2026-09-06", category: "Other", description: "Food", amountRupees: 1580, method: CASH },
  { date: "2026-09-06", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-06", category: "Other", description: "Chair", amountRupees: 750, method: UPI },
  { date: "2026-09-06", category: "Vegetables", description: "Simla/grocery", amountRupees: 1400, method: CASH },
  { date: "2026-09-06", category: "Curd", description: "Dahi", amountRupees: 410, method: CASH },
  // 07 Sept — matches reported exactly
  { date: "2026-09-07", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-07", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 35, method: CASH },
  { date: "2026-09-07", category: "Curd", description: "Dahi", amountRupees: 400, method: CASH },
  // 08 Sept — cash lines sum to ₹1,469 vs reported ₹1,479 (flagged); online lines sum to ₹2,500 (matches)
  { date: "2026-09-08", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-08", category: "Curd", description: "Dahi", amountRupees: 250, method: CASH },
  { date: "2026-09-08", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 275, method: CASH },
  { date: "2026-09-08", category: "Repair", description: "Chain & grease", amountRupees: 400, method: CASH },
  { date: "2026-09-08", category: "Maintenance", description: "Butter brush / tissue holder", amountRupees: 512, method: CASH },
  { date: "2026-09-08", category: "Repair", description: "Mobile repair", amountRupees: 900, method: UPI },
  { date: "2026-09-08", category: "Other", description: "Payment to Prashant", amountRupees: 1200, method: UPI },
  { date: "2026-09-08", category: "Repair", description: "Chain & grease (online)", amountRupees: 400, method: UPI },
  // 09 Sept — matches reported exactly
  { date: "2026-09-09", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-09", category: "Curd", description: "Dahi", amountRupees: 140, method: CASH },
  { date: "2026-09-09", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 432, method: CASH },
  // 10 Sept — matches reported exactly
  { date: "2026-09-10", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-10", category: "Curd", description: "Dahi", amountRupees: 140, method: CASH },
  { date: "2026-09-10", category: "Vegetables", description: "Neembu (lemon)", amountRupees: 60, method: CASH },
  { date: "2026-09-10", category: "Vegetables", description: "Hari Mirch", amountRupees: 10, method: CASH },
  { date: "2026-09-10", category: "Maintenance", description: "Bulb & wire", amountRupees: 320, method: UPI },
  { date: "2026-09-10", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 30, method: CASH },
  // 11 Sept — matches reported exactly
  { date: "2026-09-11", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-11", category: "Vegetables", description: "Onion", amountRupees: 2625, method: CASH },
  { date: "2026-09-11", category: "Transport", description: "Petrol", amountRupees: 500, method: CASH },
  { date: "2026-09-11", category: "Curd", description: "Dahi", amountRupees: 251, method: CASH },
  { date: "2026-09-11", category: "Repair", description: "Electrician", amountRupees: 100, method: CASH },
  { date: "2026-09-11", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 65, method: CASH },
  // 12 Sept — matches reported exactly ("CHECK = OK")
  { date: "2026-09-12", category: "Milk", description: "Milk", amountRupees: 32, method: CASH },
  { date: "2026-09-12", category: "Repair", description: "Breakpad", amountRupees: 250, method: CASH },
  { date: "2026-09-12", category: "Curd", description: "Dahi", amountRupees: 317, method: CASH },
  { date: "2026-09-12", category: "Vegetables", description: "Sabji", amountRupees: 470, method: CASH },
  { date: "2026-09-12", category: "Miscellaneous", description: "Miscellaneous", amountRupees: 50, method: CASH },
];
for (const e of EXPENSES) {
  recordExpense(
    { businessDate: e.date, category: e.category, description: e.description, amountPaise: rupees(e.amountRupees), paymentMethodId: e.method },
    ADMIN,
    ADMIN_ROLE
  );
}

// ============================================================
// 7. Remaining bank transactions not already posted by a purchase/expense
//    above. All left reconciled=0 for the owner to review/classify.
// ============================================================
interface BLine {
  date: string;
  amountRupees: number;
  description: string;
  category: "BUSINESS" | "PERSONAL" | "TRANSFER" | "SUPPLIER" | "SALARY" | "REPAIR" | "UNKNOWN";
  notes?: string;
}
const BANK_OTHER: BLine[] = [
  { date: "2026-09-05", amountRupees: 200, description: "Roshan", category: "UNKNOWN" },
  { date: "2026-09-05", amountRupees: 505, description: "Bajaj", category: "UNKNOWN" },
  { date: "2026-09-05", amountRupees: 180, description: "Stores", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 2480, description: "Desi Chaap", category: "SUPPLIER", notes: "Item-level breakdown not given in source data." },
  { date: "2026-09-06", amountRupees: 4000, description: "Prashant", category: "UNKNOWN", notes: "Recurring debit to the same person across multiple dates — purpose not specified." },
  { date: "2026-09-06", amountRupees: 100, description: "Om Jewelly", category: "PERSONAL" },
  { date: "2026-09-06", amountRupees: 30, description: "A K Sales", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 1000, description: "Rohit", category: "PERSONAL", notes: "Likely owner's own personal draw." },
  { date: "2026-09-06", amountRupees: 1580, description: "Desi Chaap", category: "SUPPLIER", notes: "Item-level breakdown not given in source data." },
  { date: "2026-09-06", amountRupees: 400, description: "Prashant", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 300, description: "Roshan", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 410, description: "Blinkit", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 32, description: "Merchant payment", category: "UNKNOWN" },
  { date: "2026-09-06", amountRupees: 750, description: "Dahi (bank payment)", category: "SUPPLIER", notes: "Not part of the itemised 06-Sept expense list — may be a separate or duplicate Dahi payment; needs review." },
  { date: "2026-09-06", amountRupees: 150, description: "Shivangi", category: "PERSONAL" },
  { date: "2026-09-06", amountRupees: 100, description: "Mr Naman", category: "PERSONAL" },
  { date: "2026-09-06", amountRupees: 1000, description: "Prashant", category: "UNKNOWN" },
  { date: "2026-09-07", amountRupees: 400, description: "Blinkit", category: "UNKNOWN" },
  { date: "2026-09-08", amountRupees: 257, description: "Tijil", category: "UNKNOWN" },
  { date: "2026-09-08", amountRupees: 507, description: "Bajaj", category: "UNKNOWN" },
  { date: "2026-09-08", amountRupees: 10, description: "Khushi", category: "UNKNOWN" },
  { date: "2026-09-09", amountRupees: 200, description: "Prashant", category: "UNKNOWN" },
];
for (const b of BANK_OTHER) {
  const id = recordBankTransaction({
    businessDate: b.date,
    txnType: "DEBIT",
    amountPaise: rupees(b.amountRupees),
    description: b.description,
    category: b.category,
    userId: ADMIN,
  });
  if (b.notes) {
    db.prepare("UPDATE bank_transactions SET notes = ? WHERE id = ?").run(b.notes, id);
  }
}

// ============================================================
// 8. Daily cash sales — no real per-order sales data exists for this
//    period, so a single reported cash-sales figure per day is posted as
//    one SALE cash transaction, feeding the same cash ledger the live app
//    uses going forward.
// ============================================================
const CASH_SALES: { date: string; rupees: number }[] = [
  { date: "2026-09-04", rupees: 1991 },
  { date: "2026-09-05", rupees: 664 },
  { date: "2026-09-06", rupees: 1082 },
  { date: "2026-09-07", rupees: 1420 },
  { date: "2026-09-08", rupees: 1719 },
  { date: "2026-09-09", rupees: 418 },
  { date: "2026-09-10", rupees: 2892 },
  { date: "2026-09-11", rupees: 460 },
  { date: "2026-09-12", rupees: 2006 },
];
for (const c of CASH_SALES) {
  recordCashTransaction({
    businessDate: c.date,
    txnType: "SALE",
    direction: "IN",
    amountPaise: rupees(c.rupees),
    reason: "Reported cash sales — historical import (no itemised order data for this period)",
    userId: ADMIN,
  });
}

// ============================================================
// 9. daily_closings — written directly (not via closeDay()) because
//    closeDay() recomputes gross/net sales from real sales_orders, which
//    don't exist for this historical period. Figures below are the
//    reported totals as given; cogs/gross_profit/net_profit are left NULL
//    pending recipes.
// ============================================================
function getCashSummary(date: string): number {
  const rows = db.prepare("SELECT direction, amount_paise FROM cash_transactions WHERE business_date <= ?").all(date) as {
    direction: "IN" | "OUT";
    amount_paise: number;
  }[];
  return rows.reduce((sum, r) => sum + (r.direction === "IN" ? r.amount_paise : -r.amount_paise), 0);
}

interface DayReport {
  date: string;
  grossSalesRupees: number;
  discountPct?: number;
  cashRupees: number;
  paytmRupees: number;
  zomatoRupees: number;
  swiggyRupees: number;
  actualCashRupees?: number;
  itemMix: string;
  reconciliationNotes?: string;
}
const DAYS: DayReport[] = [
  { date: "2026-09-04", grossSalesRupees: 7958, cashRupees: 1991, paytmRupees: 5967, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap 19.5 (Malai 4, Punjabi 7, Chatpata 0.5, Achari 2, Afgani 4, Garlic 1.5, Tikhi Titli 1, Makhmali 1, Peri Peri 2.5); Paneer Tikka: Dry 1, Malai 1; Momo: Paneer Tandoori 1, Veg Tandoori 1, Veg Malai 0.5; Rolls 13 (Punjabi 1, Chatpata 8, Garlic 2, Hariyali 1, Veg Lemon Chicken Tikka 1); Rumali 40; Butter Rumali 6.", reconciliationNotes: "Reported Tikka category total (3) differs from individual item entries (2) by 1." },
  { date: "2026-09-05", grossSalesRupees: 7959, cashRupees: 664, paytmRupees: 7295, zomatoRupees: 0, swiggyRupees: 0, actualCashRupees: 2315, itemMix: "Chaap 32.5 (Malai 10, Punjabi 7.5, Chatpata 0.5, Achari 1.5, Afgani 9, Mint 0.5, Tikhi Titli 0.5, Veg Tandoori Leg 0.5, Peri Peri 1, Veg Chicken Tikka 1.5); Paneer Tikka: Garlic 0.5; Momo: Paneer Tandoori 2, Paneer Afgani 1; Rolls 6.5 (Punjabi 2, Afgani 2.5, Garlic 1, Paneer Tikka 1); Rumali 63.", reconciliationNotes: "Reported Momo (4.5) vs listed items (3) differ by 1.5. Expense lines sum to ₹1,972 vs reported ₹1,712 (diff ₹260). Reported cash-used ₹952 vs reported cash-in-hand ₹2,315 given separately." },
  { date: "2026-09-06", grossSalesRupees: 5888, cashRupees: 1082, paytmRupees: 4806, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap 20.5; Tikka 0.5; Momo 1.5; Rolls 6; Rumali 53; Butter Rumali 1.", reconciliationNotes: "Expense lines sum to ₹8,363 vs reported ₹8,331 (diff ₹32)." },
  { date: "2026-09-07", grossSalesRupees: 9071, discountPct: 10, cashRupees: 1420, paytmRupees: 7651, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap F27 HF19 reported (individual lines sum to F27 HF20, diff 1 half): Malai F3 HF3, Punjabi F9 HF5, Chatpata F1, Achari F1 HF2, Afgani F6 HF2, Garlic F1, Tikhi Titli F2, Peri Peri HF1, Black Pepper F1 HF1, Veg Chicken Tikka HF3, Masala Stuffed F2 HF3; Paneer Tikka 2 reported (listed 2.5, diff 0.5): Dry 1, Lemon 1, Garlic 0.5; Momo: Paneer Tandoori F2 HF1; Roll: Peri Peri Paneer Tikka Roll 1; Rumali 70; Butter Rumali 2.", reconciliationNotes: "10% discount applied this day. Chaap half-count and Paneer Tikka both show small reconciliation gaps (see item mix)." },
  { date: "2026-09-08", grossSalesRupees: 8879, cashRupees: 1719, paytmRupees: 6912, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap F14 HF23; Tikka 1; Momo HF1; Rolls 10; Rumali 89; Butter Rumali 4.", reconciliationNotes: "Payment channel total ₹8,877 vs net sales ₹8,879 (diff ₹2). Expense lines sum to ₹1,469 vs reported ₹1,479 (diff ₹10)." },
  { date: "2026-09-09", grossSalesRupees: 5581, cashRupees: 418, paytmRupees: 5163, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap F6 HF16 reported (individual lines sum to F6 HF17, diff 1 half): Malai F2 HF6, Punjabi HF1, Achari F1 HF2, Afgani F1 HF3, Lemon HF1, Tikhi Titli HF2, Makhmali HF1, Peri Peri F1, Veg Chicken Tikka F1 HF1; Mushroom Afgani 1; Momo: Paneer Tandoori 1, Veg Tandoori 1; Rolls 7 (Punjabi 2, Afgani 1, Garlic 1, Tikhi Titli 1, Veg Lemon Chicken Tikka 1, Peri Peri 1); Rumali 38; Butter Rumali 5.", reconciliationNotes: "Chaap half-count reconciliation gap of 1 half (see item mix)." },
  { date: "2026-09-10", grossSalesRupees: 11156, cashRupees: 2892, paytmRupees: 8264, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap F6 HF16 reported (individual lines sum to F6 HF17, diff 1 half); Mushroom Afgani 1; Momo 2; Rolls 7; Rumali 120; Butter Rumali 5.", reconciliationNotes: "Chaap half-count reconciliation gap of 1 half (see item mix)." },
  { date: "2026-09-11", grossSalesRupees: 6555, cashRupees: 460, paytmRupees: 6095, zomatoRupees: 0, swiggyRupees: 0, itemMix: "Chaap F6 HF16 reported (individual lines sum to F6 HF17, diff 1 half); Mushroom Afgani 1; Momo 2; Rolls 7; Rumali 120; Butter Rumali 5.", reconciliationNotes: "Chaap half-count reconciliation gap of 1 half (see item mix). Note: this day's item mix is identical to 10-Sept's in source notes — may be a copy/paste repeat in the original register rather than independently counted; flagged for owner review." },
  { date: "2026-09-12", grossSalesRupees: 11616, cashRupees: 2006, paytmRupees: 8997, zomatoRupees: 0, swiggyRupees: 613, actualCashRupees: 3880, itemMix: "Chaap F27 HF33 (CHECK OK): Malai F10 HF6, Punjabi F5 HF9, Chatpata F2 HF1, Achari F3 HF1, Afgani F2 HF5, Mint HF1, Tikhi Titli F1, Makhmali HF1, Peri Peri F1 HF1, Masala Stuffed F1 HF1; Momo F1 HF2 (CHECK OK); Rolls 7; Rumali 120; Butter Rumali 5.", reconciliationNotes: "MTD through 12-Sept: reported ₹74,918 vs sum of daily reported figures ₹74,663 (diff ₹255)." },
];

for (const d of DAYS) {
  const grossPaise = rupees(d.grossSalesRupees);
  // Only 07-Sept states an explicit discount rate; everywhere else the
  // reported figure IS net sales (no separate gross given), so discount = 0.
  const discountPaise = d.discountPct ? Math.round((grossPaise * d.discountPct) / (100 - d.discountPct)) : 0;
  const netSalesPaise = grossPaise;
  const expensesRow = db
    .prepare("SELECT COALESCE(SUM(amount_paise),0) as t FROM expenses WHERE business_date = ? AND status = 'RECORDED'")
    .get(d.date) as { t: number };
  const expectedCash = getCashSummary(d.date);
  const actualCash = d.actualCashRupees != null ? rupees(d.actualCashRupees) : null;
  const cashDiff = actualCash != null ? actualCash - expectedCash : null;
  const bankBalance = getBankBalancePaise(d.date);

  const channelNote = `Payment channels — Cash ₹${d.cashRupees}, Paytm/UPI ₹${d.paytmRupees}, Zomato ₹${d.zomatoRupees}, Swiggy ₹${d.swiggyRupees}.`;
  const notes = [channelNote, `Item mix: ${d.itemMix}`, d.reconciliationNotes]
    .filter(Boolean)
    .join(" | ");

  db.prepare(
    `INSERT INTO daily_closings
      (id, business_date, status, opening_cash_paise, gross_sales_paise, discounts_paise, net_sales_paise,
       cogs_paise, gross_profit_paise, expenses_paise, net_profit_paise, expected_cash_paise, actual_cash_paise,
       cash_difference_paise, cash_diff_reason, bank_balance_paise, stock_value_paise,
       opened_by, closed_by, closed_at, notes, created_at, updated_at)
     VALUES (?, ?, 'CLOSED', 0, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("close"),
    d.date,
    grossPaise,
    discountPaise,
    netSalesPaise,
    expensesRow.t,
    expectedCash,
    actualCash,
    cashDiff,
    cashDiff != null && cashDiff !== 0 ? "Historical import — see notes for reconciliation detail." : null,
    bankBalance,
    ADMIN,
    ADMIN,
    nowIso(),
    notes,
    nowIso(),
    nowIso()
  );
}

recordAudit({
  userId: ADMIN,
  action: "HISTORICAL_DATA_IMPORTED",
  entityType: "daily_closing",
  newValue: { range: "2026-09-04 to 2026-09-12", days: DAYS.length, source: "owner master data notes" },
  reason: "Bulk import of Sept 4-12 2026 sales/expense/purchase/bank register data",
});

// ============================================================
// 10. 14-Sept physical stock count — the current, authoritative baseline
//     going forward. Superimposed on the zero-qty items created earlier
//     today; items with a confirmed cost above keep that cost (recordMovement
//     leaves avg_cost/price_pending untouched when no unit cost is passed on
//     this IN movement, since the exact cost of THIS specific stock-take
//     wasn't separately priced).
// ============================================================
interface CountLine {
  name: string;
  qtyBase: number | null; // null = "not given" for that item on the sheet
}
const STOCK_14_SEPT: CountLine[] = [
  { name: "Cream", qtyBase: 8 * 1000 },
  { name: "Cheese", qtyBase: 1 * 1000 },
  { name: "Kitchen King Masala", qtyBase: 2 * 100 },
  { name: "Meat Masala", qtyBase: 3 * 100 },
  { name: "Chicken Masala", qtyBase: 3 * 100 },
  { name: "Garam Masala", qtyBase: 6 * 100 },
  { name: "Degi Mirch", qtyBase: 6 * 100 },
  { name: "Dhaniya Powder", qtyBase: 150 },
  { name: "Lal Mirch Powder", qtyBase: 380 },
  { name: "Haldi", qtyBase: 400 },
  { name: "Zira", qtyBase: 330 },
  { name: "Black Pepper (whole)", qtyBase: 600 },
  { name: "Chaat Masala", qtyBase: 2.5 * 1000 },
  { name: "Gota Jeera", qtyBase: 70 },
  { name: "Gota Kali Mirch", qtyBase: 250 },
  { name: "Tez Patta", qtyBase: 100 },
  { name: "Sarso Oil", qtyBase: 1000 },
  { name: "Refined Oil", qtyBase: 1000 }, // "1 tin" — no tin size given elsewhere; treated as 1kg
  { name: "Besan", qtyBase: 760 },
  { name: "Ararot", qtyBase: 860 },
  { name: "Butter", qtyBase: 500 * 2 },
  { name: "Ajino Moto", qtyBase: 3 * 500 },
  { name: "Gota Lal Mirch", qtyBase: 3900 },
  { name: "Badam", qtyBase: 3400 },
  { name: "Tomato Ketchup", qtyBase: 5000 },
  { name: "Green Chilli Sauce", qtyBase: 5000 },
  { name: "Kala Namak", qtyBase: 6 * 100 },
  { name: "Amchur Powder", qtyBase: 940 },
  { name: "Tata Namak", qtyBase: 3 },
  { name: "Sugar", qtyBase: 100 },
  { name: "Red Food Colour", qtyBase: 2 },
  { name: "Green Food Colour", qtyBase: 1 },
  { name: "Yellow Food Colour", qtyBase: 1 },
  { name: "Adrak", qtyBase: 1000 },
  { name: "Lahsun", qtyBase: 2100 },
  { name: "Achar", qtyBase: 1 },
  { name: "Onion", qtyBase: 40 }, // counted in "bora" (sacks) at this item's base unit
  { name: "Frozen Chaap", qtyBase: 40 * 1000 },
  { name: "Lemon", qtyBase: 0 },
  { name: "Mushroom", qtyBase: 1 },
  { name: "Hara Mirch", qtyBase: 200 },
  { name: "Ajwain", qtyBase: 500 },
  { name: "Coal", qtyBase: 45 * 1000 },
  { name: "Kasturi Methi", qtyBase: 1000 },
  { name: "Simla/Capsicum", qtyBase: 2000 },
  { name: "Curd", qtyBase: 0 },
  { name: "Peri Peri Masala", qtyBase: 14 },
  // Disposables
  { name: "White Plate", qtyBase: 0 },
  { name: "Large Plate", qtyBase: 4 },
  { name: "Small Plate", qtyBase: 6 },
  { name: "Large Delivery Box", qtyBase: 50 },
  { name: "Small Delivery Box", qtyBase: 100 },
  { name: "Tissue", qtyBase: 3 },
  { name: "Fork", qtyBase: 0 },
  { name: "Toothpick", qtyBase: 2 },
  { name: "Aluminium Foil", qtyBase: 0 },
  { name: "Cap", qtyBase: 1 },
  { name: "Carry Bag", qtyBase: 0.5 },
];

const BUSINESS_DATE_STOCK = "2026-09-14";
let adjusted = 0;
for (const line of STOCK_14_SEPT) {
  if (line.qtyBase == null || line.qtyBase <= 0) continue;
  const id = itemId(line.name);
  const current = (db.prepare("SELECT current_qty_base FROM inventory_items WHERE id = ?").get(id) as { current_qty_base: number }).current_qty_base;
  const delta = line.qtyBase - current;
  if (delta === 0) continue;
  recordMovement({
    inventoryItemId: id,
    movementType: "STOCK_ADJUSTMENT",
    direction: delta > 0 ? "IN" : "OUT",
    quantityBase: Math.abs(delta),
    unitCostPaisePerBase: null,
    referenceType: "STOCK_COUNT",
    reason: `Physical stock count, ${BUSINESS_DATE_STOCK} — set to counted quantity`,
    businessDate: BUSINESS_DATE_STOCK,
    userId: ADMIN,
    allowNegativeStock: true,
  });
  adjusted++;
}

recordAudit({
  userId: ADMIN,
  action: "STOCK_IMPORTED",
  entityType: "inventory_item",
  newValue: { businessDate: BUSINESS_DATE_STOCK, itemsAdjusted: adjusted, source: "physical count sheet, 14 Sept 2026" },
  reason: `Bulk import of physical stock count for ${BUSINESS_DATE_STOCK} (latest baseline, supersedes earlier zero-qty placeholders)`,
});

console.log(`\n✓ Master data import complete.`);
console.log(`  ${itemsCreated} new inventory items created.`);
console.log(`  ${MANUAL_COSTS.length} items given a manually-confirmed cost.`);
console.log(`  6 purchase bills recorded (04, 07, 09, 11, 12 Sept ×2).`);
console.log(`  ${EXPENSES.length} expense lines recorded.`);
console.log(`  ${BANK_OTHER.length} standalone bank transactions recorded (all reconciled=0, need owner review).`);
console.log(`  ${CASH_SALES.length} days of cash sales posted to the cash ledger.`);
console.log(`  ${DAYS.length} daily_closings rows written (04–12 Sept) — COGS/profit left NULL pending recipes.`);
console.log(`  ${adjusted} inventory items adjusted to the 14-Sept physical count.`);
