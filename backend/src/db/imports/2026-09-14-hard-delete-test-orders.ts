/**
 * Owner explicitly asked (twice, with exact order numbers) to remove
 * orders #1001-#1004 from the database entirely — not just refund them
 * (already done in the previous pass). These were all confirmed test/cleanup
 * orders with zero real business meaning, already financially reversed.
 *
 * There's no hard-delete API for orders by design (audit integrity), so
 * this goes around the service layer directly, in one transaction:
 *   - sales_order_items, payments, refunds, discounts for these orders
 *   - the matching cash_transactions (SALE+REFUND pairs, already net zero)
 *   - the matching bank_transactions (CREDIT+DEBIT pairs, already net zero)
 *   - the sales_orders rows themselves
 * audit_logs entries referencing these orders are deliberately LEFT ALONE —
 * audit log is append-only even across a hard delete, so there's a record
 * that these orders existed and were removed.
 *
 * Usage: npx tsx src/db/imports/2026-09-14-hard-delete-test-orders.ts
 */
import { db } from "../connection";
import { runMigrations } from "../migrate";
runMigrations();

const ORDER_NUMBERS = [1001, 1002, 1003, 1004];

const orders = db
  .prepare(`SELECT id, order_number FROM sales_orders WHERE order_number IN (${ORDER_NUMBERS.join(",")})`)
  .all() as { id: string; order_number: number }[];

if (orders.length === 0) {
  console.log("No matching orders found — nothing to delete.");
  process.exit(0);
}

const orderIds = orders.map((o) => o.id);
const placeholders = orderIds.map(() => "?").join(",");

const txn = db.transaction(() => {
  const delItems = db.prepare(`DELETE FROM sales_order_items WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delDiscounts = db.prepare(`DELETE FROM discounts WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delRefunds = db.prepare(`DELETE FROM refunds WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delPayments = db.prepare(`DELETE FROM payments WHERE sales_order_id IN (${placeholders})`).run(...orderIds);
  const delCash = db.prepare(`DELETE FROM cash_transactions WHERE reference_id IN (${placeholders})`).run(...orderIds);

  // Bank transactions for these orders aren't linked by reference_id (they
  // were posted with a free-text description, e.g. "Sale — order #1002
  // (Zomato)"), so match on the order number appearing in the description.
  let delBank = 0;
  for (const o of orders) {
    const res = db
      .prepare(`DELETE FROM bank_transactions WHERE description LIKE ?`)
      .run(`%#${o.order_number}%`);
    delBank += res.changes;
  }

  const delOrders = db.prepare(`DELETE FROM sales_orders WHERE id IN (${placeholders})`).run(...orderIds);

  console.log(`Deleted: ${delItems.changes} order items, ${delDiscounts.changes} discounts, ${delRefunds.changes} refund records,`);
  console.log(`         ${delPayments.changes} payments, ${delCash.changes} cash txns, ${delBank} bank txns, ${delOrders.changes} orders.`);
});
txn();

console.log(`\n✓ Orders #${orders.map((o) => o.order_number).join(", #")} permanently removed.`);
console.log(`  audit_logs entries for these orders were left in place (append-only, records that they existed).`);
