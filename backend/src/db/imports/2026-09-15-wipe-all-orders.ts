/**
 * Owner asked to delete all current orders (#1005-#1012) and reset back to
 * zero, reversing the real cash-ledger impact of the completed ones
 * (₹1,224 across 4 SALE cash transactions — no bank transactions and no
 * inventory movements were tied to these orders, so nothing else to
 * reverse). audit_logs entries are left in place (append-only, records
 * that these orders existed).
 *
 * Usage: npx tsx src/db/imports/2026-09-15-wipe-all-orders.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

const orders = db.prepare("SELECT id, order_number FROM sales_orders").all() as { id: string; order_number: number }[];

if (orders.length === 0) {
  console.log("No orders found — nothing to delete.");
  process.exit(0);
}

const orderIds = orders.map((o) => o.id);
const placeholders = orderIds.map(() => "?").join(",");

const txn = db.transaction(() => {
  // discounts.sales_order_item_id references sales_order_items(id), so
  // discounts must be deleted first.
  const delDiscounts = db.prepare(`DELETE FROM discounts WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delItems = db.prepare(`DELETE FROM sales_order_items WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delRefunds = db.prepare(`DELETE FROM refunds WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delPayments = db.prepare(`DELETE FROM payments WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delCash = db.prepare(`DELETE FROM cash_transactions WHERE reference_id IN (${placeholders})`).run(...orderIds);

  let delBank = 0;
  for (const o of orders) {
    const res = db.prepare(`DELETE FROM bank_transactions WHERE description LIKE ?`).run(`%#${o.order_number}%`);
    delBank += res.changes;
  }

  const delOrders = db.prepare(`DELETE FROM sales_orders WHERE id IN (${placeholders})`).run(...orderIds);

  console.log(`Deleted: ${delItems.changes} order items, ${delDiscounts.changes} discounts, ${delRefunds.changes} refund records,`);
  console.log(`         ${delPayments.changes} payments, ${delCash.changes} cash txns, ${delBank} bank txns, ${delOrders.changes} orders.`);
});
txn();

console.log(`\n✓ Orders #${orders.map((o) => o.order_number).join(", #")} permanently removed. Back to zero orders.`);
