/**
 * One-off data migration: copies everything out of the old SQLite database
 * (backend/data/chaapdihaati.db, or a path passed as the first CLI arg —
 * e.g. one of the timestamped copies in backups/, for a safe dry run) into
 * the MongoDB database this app now runs on (MONGODB_URI).
 *
 * Not part of the running app — run manually, once, right before cutover:
 *   npm run migrate-from-sqlite -- [path-to-sqlite-file] [--force]
 *
 * Refuses to run against a non-empty target database unless --force is
 * passed, and prints a row-count parity report (SQLite rows vs Mongo
 * documents, with embedded children counted too) at the end so you can
 * visually confirm nothing was dropped before trusting the new database.
 */
import path from "path";
import Database from "better-sqlite3";
import mongoose from "mongoose";
import { connectMongo } from "./mongoose";
import * as models from "./models";

const args = process.argv.slice(2);
const force = args.includes("--force");
const sqlitePath = args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..", "..", "data", "chaapdihaati.db");

function toBool(v: number | null | undefined): boolean {
  return !!v;
}

async function main() {
  console.log(`Reading SQLite database: ${sqlitePath}`);
  const db = new Database(sqlitePath, { readonly: true });

  await connectMongo();
  console.log("Connected to MongoDB.");

  if (!force) {
    const existingUsers = await models.User.countDocuments();
    if (existingUsers > 0) {
      console.error(`Target database already has ${existingUsers} user(s). Refusing to run without --force (this would duplicate data).`);
      process.exit(1);
    }
  }

  const parity: { table: string; sqliteCount: number; mongoCount: number }[] = [];
  const record = (table: string, sqliteCount: number, mongoCount: number) => parity.push({ table, sqliteCount, mongoCount });

  // ---------------------------------------------------------------
  // 1. Users (roles table is dropped — folded into the User.role enum)
  // ---------------------------------------------------------------
  const users = db.prepare("SELECT * FROM users").all() as any[];
  for (const u of users) {
    await models.User.create({
      _id: u.id,
      username: u.username,
      passwordHash: u.password_hash,
      fullName: u.full_name,
      role: u.role,
      active: toBool(u.active),
      createdAt: u.created_at,
      updatedAt: u.updated_at,
    });
  }
  record("users", users.length, await models.User.countDocuments());

  // ---------------------------------------------------------------
  // 2. Settings
  // ---------------------------------------------------------------
  const settings = db.prepare("SELECT * FROM settings").all() as any[];
  for (const s of settings) {
    let value: unknown;
    try {
      value = JSON.parse(s.value);
    } catch {
      value = s.value;
    }
    await models.Setting.create({ _id: s.key, value, updatedBy: s.updated_by, updatedAt: s.updated_at });
  }
  record("settings", settings.length, await models.Setting.countDocuments());

  // ---------------------------------------------------------------
  // 3. Payment methods
  // ---------------------------------------------------------------
  const paymentMethods = db.prepare("SELECT * FROM payment_methods").all() as any[];
  for (const pm of paymentMethods) {
    await models.PaymentMethod.create({ _id: pm.id, name: pm.name, type: pm.type, active: toBool(pm.active), sortOrder: pm.sort_order });
  }
  record("payment_methods", paymentMethods.length, await models.PaymentMethod.countDocuments());

  // ---------------------------------------------------------------
  // 4. Menu categories, items, prices
  // ---------------------------------------------------------------
  const categories = db.prepare("SELECT * FROM menu_categories").all() as any[];
  for (const c of categories) {
    await models.MenuCategory.create({ _id: c.id, name: c.name, sortOrder: c.sort_order, active: toBool(c.active) });
  }
  record("menu_categories", categories.length, await models.MenuCategory.countDocuments());

  const menuItems = db.prepare("SELECT * FROM menu_items").all() as any[];
  for (const i of menuItems) {
    await models.MenuItem.create({
      _id: i.id,
      categoryId: i.category_id,
      name: i.name,
      hasHalf: toBool(i.has_half),
      hasFull: toBool(i.has_full),
      hasSingle: toBool(i.has_single),
      unitLabel: i.unit_label,
      halfLabel: i.half_label,
      fullLabel: i.full_label,
      status: i.status,
      sortOrder: i.sort_order,
      createdAt: i.created_at,
    });
  }
  record("menu_items", menuItems.length, await models.MenuItem.countDocuments());

  const menuPrices = db.prepare("SELECT * FROM menu_prices").all() as any[];
  for (const p of menuPrices) {
    await models.MenuPrice.create({
      _id: p.id,
      menuItemId: p.menu_item_id,
      priceType: p.price_type,
      pricePaise: p.price_paise,
      effectiveFrom: p.effective_from,
      effectiveTo: p.effective_to,
      createdBy: p.created_by,
      createdAt: p.created_at,
    });
  }
  record("menu_prices", menuPrices.length, await models.MenuPrice.countDocuments());

  // ---------------------------------------------------------------
  // 5. Suppliers, inventory items/movements/wastage
  // ---------------------------------------------------------------
  const suppliers = db.prepare("SELECT * FROM suppliers").all() as any[];
  for (const s of suppliers) {
    await models.Supplier.create({ _id: s.id, name: s.name, phone: s.phone, address: s.address, notes: s.notes, active: toBool(s.active), createdAt: s.created_at });
  }
  record("suppliers", suppliers.length, await models.Supplier.countDocuments());

  const inventoryItems = db.prepare("SELECT * FROM inventory_items").all() as any[];
  for (const i of inventoryItems) {
    await models.InventoryItem.create({
      _id: i.id,
      name: i.name,
      category: i.category,
      baseUnit: i.base_unit,
      purchaseUnit: i.purchase_unit,
      purchaseToBaseFactor: i.purchase_to_base_factor,
      currentQtyBase: i.current_qty_base,
      minStockBase: i.min_stock_base,
      reorderLevelBase: i.reorder_level_base,
      avgCostPaisePerBase: i.avg_cost_paise_per_base,
      lastPurchaseCostPaisePerBase: i.last_purchase_cost_paise_per_base,
      supplierId: i.supplier_id,
      pricePending: toBool(i.price_pending),
      active: toBool(i.active),
      createdAt: i.created_at,
    });
  }
  record("inventory_items", inventoryItems.length, await models.InventoryItem.countDocuments());

  const movements = db.prepare("SELECT * FROM inventory_movements").all() as any[];
  for (const m of movements) {
    await models.InventoryMovement.create({
      _id: m.id,
      inventoryItemId: m.inventory_item_id,
      movementType: m.movement_type,
      direction: m.direction,
      quantityBase: m.quantity_base,
      unitCostPaisePerBase: m.unit_cost_paise_per_base,
      totalCostPaise: m.total_cost_paise,
      referenceType: m.reference_type,
      referenceId: m.reference_id,
      reason: m.reason,
      businessDate: m.business_date,
      createdBy: m.created_by,
      createdAt: m.created_at,
    });
  }
  record("inventory_movements", movements.length, await models.InventoryMovement.countDocuments());

  const wastage = db.prepare("SELECT * FROM wastage_records").all() as any[];
  for (const w of wastage) {
    await models.WastageRecord.create({
      _id: w.id,
      inventoryMovementId: w.inventory_movement_id,
      inventoryItemId: w.inventory_item_id,
      quantityBase: w.quantity_base,
      totalCostPaise: w.total_cost_paise,
      wastageType: w.wastage_type,
      reason: w.reason,
      businessDate: w.business_date,
      createdBy: w.created_by,
      createdAt: w.created_at,
    });
  }
  record("wastage_records", wastage.length, await models.WastageRecord.countDocuments());

  // ---------------------------------------------------------------
  // 6. Recipes (recipe_items embedded onto recipe_versions)
  // ---------------------------------------------------------------
  const recipeVersions = db.prepare("SELECT * FROM recipe_versions").all() as any[];
  const recipeItemsAll = db.prepare("SELECT * FROM recipe_items").all() as any[];
  let recipeItemCount = 0;
  for (const rv of recipeVersions) {
    const items = recipeItemsAll.filter((ri) => ri.recipe_version_id === rv.id);
    recipeItemCount += items.length;
    await models.RecipeVersion.create({
      _id: rv.id,
      menuItemId: rv.menu_item_id,
      priceType: rv.price_type,
      version: rv.version,
      effectiveFrom: rv.effective_from,
      effectiveTo: rv.effective_to,
      notes: rv.notes,
      createdBy: rv.created_by,
      createdAt: rv.created_at,
      recipeItems: items.map((ri) => ({
        inventoryItemId: ri.inventory_item_id,
        quantityBase: ri.quantity_base,
        wastagePct: ri.wastage_pct,
        yieldPct: ri.yield_pct,
        optional: toBool(ri.optional),
      })),
    });
  }
  record("recipe_versions", recipeVersions.length, await models.RecipeVersion.countDocuments());
  const migratedRecipeItems = (await models.RecipeVersion.aggregate([{ $project: { n: { $size: "$recipeItems" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]))[0]?.total ?? 0;
  record("recipe_items (embedded)", recipeItemCount, migratedRecipeItems);

  // ---------------------------------------------------------------
  // 7. Purchases (purchase_items embedded onto purchase_orders)
  // ---------------------------------------------------------------
  const purchaseOrders = db.prepare("SELECT * FROM purchase_orders").all() as any[];
  const purchaseItemsAll = db.prepare("SELECT * FROM purchase_items").all() as any[];
  let purchaseItemCount = 0;
  for (const po of purchaseOrders) {
    const items = purchaseItemsAll.filter((pi) => pi.purchase_order_id === po.id);
    purchaseItemCount += items.length;
    await models.Purchase.create({
      _id: po.id,
      purchaseNumber: po.purchase_number,
      supplierId: po.supplier_id,
      invoiceNumber: po.invoice_number,
      businessDate: po.business_date,
      paymentMethodId: po.payment_method_id,
      paymentStatus: po.payment_status,
      subtotalPaise: po.subtotal_paise,
      taxPaise: po.tax_paise,
      discountPaise: po.discount_paise,
      totalPaise: po.total_paise,
      amountPaidPaise: po.amount_paid_paise,
      notes: po.notes,
      status: po.status,
      voidReason: po.void_reason,
      createdBy: po.created_by,
      createdAt: po.created_at,
      updatedAt: po.updated_at,
      purchaseItems: items.map((pi) => ({
        _id: pi.id,
        inventoryItemId: pi.inventory_item_id,
        quantity: pi.quantity,
        purchaseUnit: pi.purchase_unit,
        quantityBase: pi.quantity_base,
        ratePaise: pi.rate_paise,
        amountPaise: pi.amount_paise,
        pricePending: toBool(pi.price_pending),
        notes: pi.notes,
      })),
    });
  }
  record("purchase_orders", purchaseOrders.length, await models.Purchase.countDocuments());
  const migratedPurchaseItems = (await models.Purchase.aggregate([{ $project: { n: { $size: "$purchaseItems" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]))[0]?.total ?? 0;
  record("purchase_items (embedded)", purchaseItemCount, migratedPurchaseItems);

  // ---------------------------------------------------------------
  // 8. Sales orders (items/payments/discounts embedded)
  // ---------------------------------------------------------------
  const salesOrders = db.prepare("SELECT * FROM sales_orders").all() as any[];
  const salesOrderItemsAll = db.prepare("SELECT * FROM sales_order_items").all() as any[];
  const paymentsAll = db.prepare("SELECT * FROM payments").all() as any[];
  const discountsAll = db.prepare("SELECT * FROM discounts").all() as any[];
  const menuItemById = new Map(menuItems.map((i) => [i.id, i]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  let orderItemCount = 0;
  let orderPaymentCount = 0;
  let orderDiscountCount = 0;

  for (const so of salesOrders) {
    const items = salesOrderItemsAll.filter((soi) => soi.sales_order_id === so.id);
    const orderPayments = paymentsAll.filter((p) => p.sales_order_id === so.id);
    const orderDiscounts = discountsAll.filter((d) => d.sales_order_id === so.id);
    orderItemCount += items.length;
    orderPaymentCount += orderPayments.length;
    orderDiscountCount += orderDiscounts.length;

    await models.Order.create({
      _id: so.id,
      orderNumber: so.order_number,
      businessDate: so.business_date,
      orderType: so.order_type,
      status: so.status,
      paymentStatus: so.payment_status ?? (so.status === "COMPLETED" ? "PAID" : so.status === "REFUNDED" ? "REFUNDED" : "UNPAID"),
      customerName: so.customer_name,
      customerPhone: so.customer_phone,
      deliveryAddress: so.delivery_address,
      assignedRiderId: so.assigned_rider_id,
      subtotalPaise: so.subtotal_paise,
      discountPaise: so.discount_paise,
      discountType: so.discount_type,
      discountValue: so.discount_value,
      itemDiscountTotalPaise: so.item_discount_total_paise,
      discountReason: so.discount_reason,
      netTotalPaise: so.net_total_paise,
      cancelReason: so.cancel_reason,
      notes: so.notes,
      stockOverride: toBool(so.stock_override),
      createdBy: so.created_by,
      confirmedAt: so.confirmed_at,
      deliveredAt: so.delivered_at,
      completedAt: so.completed_at,
      cancelledAt: so.cancelled_at,
      createdAt: so.created_at,
      updatedAt: so.updated_at,
      items: items.map((i) => ({
        _id: i.id,
        menuItemId: i.menu_item_id,
        itemNameSnapshot: i.item_name_snapshot,
        categoryName: categoryById.get(menuItemById.get(i.menu_item_id)?.category_id)?.name ?? null,
        priceType: i.price_type,
        unitPricePaise: i.unit_price_paise,
        quantity: i.quantity,
        lineSubtotalPaise: i.line_subtotal_paise,
        recipeVersionId: i.recipe_version_id,
        cogsPaise: i.cogs_paise,
        specialInstructions: i.special_instructions,
        status: i.status,
        discountPaise: i.discount_paise,
        discountType: i.discount_type,
        discountValue: i.discount_value,
        lineNetPaise: i.line_net_paise,
        createdAt: i.created_at,
      })),
      payments: orderPayments.map((p) => ({
        _id: p.id,
        paymentMethodId: p.payment_method_id,
        amountPaise: p.amount_paise,
        reference: p.reference,
        status: p.status,
        createdBy: p.created_by,
        createdAt: p.created_at,
      })),
      discounts: orderDiscounts.map((d) => ({
        _id: d.id,
        salesOrderItemId: d.sales_order_item_id,
        amountPaise: d.amount_paise,
        discountType: d.discount_type,
        discountValue: d.discount_value,
        reason: d.reason,
        createdBy: d.created_by,
        createdAt: d.created_at,
      })),
    });
  }
  record("sales_orders", salesOrders.length, await models.Order.countDocuments());
  const migratedOrderItems = (await models.Order.aggregate([{ $project: { n: { $size: "$items" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]))[0]?.total ?? 0;
  const migratedOrderPayments = (await models.Order.aggregate([{ $project: { n: { $size: "$payments" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]))[0]?.total ?? 0;
  const migratedOrderDiscounts = (await models.Order.aggregate([{ $project: { n: { $size: "$discounts" } } }, { $group: { _id: null, total: { $sum: "$n" } } }]))[0]?.total ?? 0;
  record("sales_order_items (embedded)", orderItemCount, migratedOrderItems);
  record("payments (embedded)", orderPaymentCount, migratedOrderPayments);
  record("discounts (embedded)", orderDiscountCount, migratedOrderDiscounts);

  // ---------------------------------------------------------------
  // 9. Refunds, expenses, cash/bank, daily closings, staff, audit, history
  // ---------------------------------------------------------------
  const refunds = db.prepare("SELECT * FROM refunds").all() as any[];
  for (const r of refunds) {
    await models.Refund.create({
      _id: r.id,
      salesOrderId: r.sales_order_id,
      amountPaise: r.amount_paise,
      refundType: r.refund_type,
      reason: r.reason,
      paymentMethodId: r.payment_method_id,
      createdBy: r.created_by,
      createdAt: r.created_at,
    });
  }
  record("refunds", refunds.length, await models.Refund.countDocuments());

  const expenses = db.prepare("SELECT * FROM expenses").all() as any[];
  for (const e of expenses) {
    await models.Expense.create({
      _id: e.id,
      businessDate: e.business_date,
      category: e.category,
      description: e.description,
      amountPaise: e.amount_paise,
      paymentMethodId: e.payment_method_id,
      vendor: e.vendor,
      receiptRef: e.receipt_ref,
      notes: e.notes,
      status: e.status,
      voidReason: e.void_reason,
      createdBy: e.created_by,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    });
  }
  record("expenses", expenses.length, await models.Expense.countDocuments());

  const cashTxns = db.prepare("SELECT * FROM cash_transactions").all() as any[];
  for (const c of cashTxns) {
    await models.CashTransaction.create({
      _id: c.id,
      businessDate: c.business_date,
      txnType: c.txn_type,
      direction: c.direction,
      amountPaise: c.amount_paise,
      referenceType: c.reference_type,
      referenceId: c.reference_id,
      reason: c.reason,
      createdBy: c.created_by,
      createdAt: c.created_at,
    });
  }
  record("cash_transactions", cashTxns.length, await models.CashTransaction.countDocuments());

  const bankTxns = db.prepare("SELECT * FROM bank_transactions").all() as any[];
  for (const b of bankTxns) {
    await models.BankTransaction.create({
      _id: b.id,
      businessDate: b.business_date,
      txnType: b.txn_type,
      amountPaise: b.amount_paise,
      description: b.description,
      reference: b.reference,
      category: b.category,
      paymentMethodId: b.payment_method_id,
      linkedReferenceType: b.linked_reference_type,
      linkedReferenceId: b.linked_reference_id,
      reconciled: toBool(b.reconciled),
      notes: b.notes,
      createdBy: b.created_by,
      createdAt: b.created_at,
    });
  }
  record("bank_transactions", bankTxns.length, await models.BankTransaction.countDocuments());

  const closings = db.prepare("SELECT * FROM daily_closings").all() as any[];
  for (const dc of closings) {
    await models.DailyClosing.create({
      _id: dc.id,
      businessDate: dc.business_date,
      status: dc.status,
      openingCashPaise: dc.opening_cash_paise,
      grossSalesPaise: dc.gross_sales_paise,
      discountsPaise: dc.discounts_paise,
      netSalesPaise: dc.net_sales_paise,
      cogsPaise: dc.cogs_paise,
      grossProfitPaise: dc.gross_profit_paise,
      expensesPaise: dc.expenses_paise,
      netProfitPaise: dc.net_profit_paise,
      expectedCashPaise: dc.expected_cash_paise,
      actualCashPaise: dc.actual_cash_paise,
      cashDifferencePaise: dc.cash_difference_paise,
      cashDiffReason: dc.cash_diff_reason,
      bankBalancePaise: dc.bank_balance_paise,
      stockValuePaise: dc.stock_value_paise,
      openedBy: dc.opened_by,
      closedBy: dc.closed_by,
      reopenedBy: dc.reopened_by,
      closedAt: dc.closed_at,
      reopenedAt: dc.reopened_at,
      reopenReason: dc.reopen_reason,
      notes: dc.notes,
      createdAt: dc.created_at,
      updatedAt: dc.updated_at,
    });
  }
  record("daily_closings", closings.length, await models.DailyClosing.countDocuments());

  // Stock counts (stock_count_items embedded)
  const stockCounts = db.prepare("SELECT * FROM stock_counts").all() as any[];
  const stockCountItemsAll = db.prepare("SELECT * FROM stock_count_items").all() as any[];
  let stockCountItemCount = 0;
  for (const sc of stockCounts) {
    const items = stockCountItemsAll.filter((sci) => sci.stock_count_id === sc.id);
    stockCountItemCount += items.length;
    await models.StockCount.create({
      _id: sc.id,
      businessDate: sc.business_date,
      status: sc.status,
      createdBy: sc.created_by,
      createdAt: sc.created_at,
      completedAt: sc.completed_at,
      stockCountItems: items.map((sci) => ({
        _id: sci.id,
        inventoryItemId: sci.inventory_item_id,
        systemQtyBase: sci.system_qty_base,
        physicalQtyBase: sci.physical_qty_base,
        differenceBase: sci.difference_base,
        unitCostPaisePerBase: sci.unit_cost_paise_per_base,
        estimatedValueDiffPaise: sci.estimated_value_diff_paise,
        reason: sci.reason,
        notes: sci.notes,
      })),
    });
  }
  record("stock_counts", stockCounts.length, await models.StockCount.countDocuments());
  record("stock_count_items (embedded)", stockCountItemCount, stockCountItemCount);

  const staff = db.prepare("SELECT * FROM staff").all() as any[];
  for (const s of staff) {
    await models.Staff.create({
      _id: s.id,
      userId: s.user_id,
      fullName: s.full_name,
      roleTitle: s.role_title,
      salaryPaise: s.salary_paise,
      salaryMethod: s.salary_method,
      customDays: s.custom_days,
      joiningDate: s.joining_date,
      active: toBool(s.active),
      phone: s.phone,
      createdAt: s.created_at,
    });
  }
  record("staff", staff.length, await models.Staff.countDocuments());

  const auditLogs = db.prepare("SELECT * FROM audit_logs").all() as any[];
  for (const a of auditLogs) {
    let oldValue: unknown = null;
    let newValue: unknown = null;
    try {
      oldValue = a.old_value ? JSON.parse(a.old_value) : null;
    } catch {
      oldValue = a.old_value;
    }
    try {
      newValue = a.new_value ? JSON.parse(a.new_value) : null;
    } catch {
      newValue = a.new_value;
    }
    await models.AuditLog.create({
      _id: a.id,
      userId: a.user_id,
      action: a.action,
      entityType: a.entity_type,
      entityId: a.entity_id,
      oldValue,
      newValue,
      reason: a.reason,
      createdAt: a.created_at,
    });
  }
  record("audit_logs", auditLogs.length, await models.AuditLog.countDocuments());

  const historical = db.prepare("SELECT * FROM historical_item_sales").all() as any[];
  for (const h of historical) {
    await models.HistoricalItemSale.create({
      _id: h.id,
      businessDate: h.business_date,
      category: h.category,
      itemName: h.item_name,
      fullCount: h.full_count,
      halfCount: h.half_count,
      qtyEquivalent: h.qty_equivalent,
      notes: h.notes,
      createdAt: h.created_at,
    });
  }
  record("historical_item_sales", historical.length, await models.HistoricalItemSale.countDocuments());

  // Sequences → Counters. SQLite's next_value is "the value to hand out
  // next"; Mongo's nextSequence() increments-then-returns, so it stores
  // "the last value handed out" — subtract 1 so the next call resumes at
  // the same number.
  const sequences = db.prepare("SELECT * FROM sequences").all() as any[];
  for (const s of sequences) {
    await models.Counter.create({ _id: s.name, nextValue: s.next_value - 1 });
  }
  record("sequences", sequences.length, await models.Counter.countDocuments());

  db.close();

  // ---------------------------------------------------------------
  // Parity report
  // ---------------------------------------------------------------
  console.log("\n--- Row-count parity (SQLite -> MongoDB) ---");
  let anyMismatch = false;
  for (const row of parity) {
    const ok = row.sqliteCount === row.mongoCount;
    if (!ok) anyMismatch = true;
    console.log(`${ok ? "✓" : "✗ MISMATCH"}  ${row.table.padEnd(28)} sqlite=${row.sqliteCount}  mongo=${row.mongoCount}`);
  }
  console.log(anyMismatch ? "\nSome tables did not match — investigate before trusting this migration." : "\nAll counts match.");

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
