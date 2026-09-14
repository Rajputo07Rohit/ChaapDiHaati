import { db } from "../../db/connection";
import { getSalesSummary, getExpensesTotal } from "./salesAggregate.service";

export function dailySalesReport(from: string, to: string) {
  const rows = db
    .prepare(
      `SELECT so.business_date,
              COUNT(*) as orders,
              COALESCE(SUM(so.subtotal_paise),0) as gross_sales_paise,
              COALESCE(SUM(so.discount_paise + so.item_discount_total_paise),0) as discount_paise,
              COALESCE(SUM(so.net_total_paise),0) as net_sales_paise
       FROM sales_orders so
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED'
       GROUP BY so.business_date ORDER BY so.business_date ASC`
    )
    .all(from, to) as { business_date: string; orders: number; gross_sales_paise: number; discount_paise: number; net_sales_paise: number }[];

  const paymentRows = db
    .prepare(
      `SELECT so.business_date, pm.name as method_name, pm.type as method_type, COALESCE(SUM(p.amount_paise),0) as amount_paise
       FROM payments p
       JOIN payment_methods pm ON pm.id = p.payment_method_id
       JOIN sales_orders so ON so.id = p.sales_order_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED' AND p.status = 'ACTIVE'
       GROUP BY so.business_date, pm.id`
    )
    .all(from, to) as { business_date: string; method_name: string; method_type: string; amount_paise: number }[];

  return rows.map((r) => ({
    ...r,
    paymentBreakdown: paymentRows.filter((p) => p.business_date === r.business_date),
  }));
}

export function itemWiseSalesReport(from: string, to: string) {
  const rows = db
    .prepare(
      `SELECT soi.menu_item_id, soi.item_name_snapshot as item_name, soi.price_type,
              COALESCE(SUM(soi.quantity),0) as qty_sold,
              COALESCE(SUM(soi.line_net_paise),0) as revenue_paise,
              COALESCE(SUM(soi.cogs_paise),0) as cogs_paise
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED' AND soi.status = 'ACTIVE'
       GROUP BY soi.menu_item_id, soi.price_type
       ORDER BY revenue_paise DESC`
    )
    .all(from, to) as {
    menu_item_id: string;
    item_name: string;
    price_type: string;
    qty_sold: number;
    revenue_paise: number;
    cogs_paise: number;
  }[];

  return rows.map((r) => ({ ...r, gross_profit_paise: r.revenue_paise - r.cogs_paise }));
}

export function categorySalesReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT mc.name as category_name,
              COALESCE(SUM(soi.quantity),0) as qty_sold,
              COALESCE(SUM(soi.line_net_paise),0) as revenue_paise,
              COALESCE(SUM(soi.cogs_paise),0) as cogs_paise
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       JOIN menu_items mi ON mi.id = soi.menu_item_id
       JOIN menu_categories mc ON mc.id = mi.category_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED' AND soi.status = 'ACTIVE'
       GROUP BY mc.id ORDER BY revenue_paise DESC`
    )
    .all(from, to);
}

export function paymentMethodReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT pm.name as method_name, pm.type as method_type, COUNT(*) as txn_count, COALESCE(SUM(p.amount_paise),0) as amount_paise
       FROM payments p
       JOIN payment_methods pm ON pm.id = p.payment_method_id
       JOIN sales_orders so ON so.id = p.sales_order_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED' AND p.status = 'ACTIVE'
       GROUP BY pm.id ORDER BY amount_paise DESC`
    )
    .all(from, to);
}

export function profitLossReport(from: string, to: string) {
  const sales = getSalesSummary(from, to);
  const expenses = getExpensesTotal(from, to);
  const grossProfit = sales.netSalesPaise - sales.cogsPaise;
  const netProfit = grossProfit - expenses;
  return {
    grossSalesPaise: sales.grossSalesPaise,
    discountsPaise: sales.discountsPaise,
    netSalesPaise: sales.netSalesPaise,
    cogsPaise: sales.cogsPaise,
    grossProfitPaise: grossProfit,
    expensesPaise: expenses,
    netProfitPaise: netProfit,
    foodCostPct: sales.netSalesPaise > 0 ? (sales.cogsPaise / sales.netSalesPaise) * 100 : 0,
    grossMarginPct: sales.netSalesPaise > 0 ? (grossProfit / sales.netSalesPaise) * 100 : 0,
    netMarginPct: sales.netSalesPaise > 0 ? (netProfit / sales.netSalesPaise) * 100 : 0,
  };
}

export function inventoryValuationReport() {
  return db
    .prepare(
      `SELECT id, name, category, base_unit, current_qty_base, avg_cost_paise_per_base,
              ROUND(current_qty_base * avg_cost_paise_per_base) as value_paise, price_pending
       FROM inventory_items WHERE active = 1 ORDER BY value_paise DESC`
    )
    .all();
}

export function purchaseReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT po.*, s.name as supplier_name FROM purchase_orders po
       LEFT JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.business_date BETWEEN ? AND ? ORDER BY po.business_date DESC`
    )
    .all(from, to);
}

export function expenseReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT category, COUNT(*) as count, SUM(amount_paise) as total_paise FROM expenses
       WHERE business_date BETWEEN ? AND ? AND status = 'RECORDED' GROUP BY category ORDER BY total_paise DESC`
    )
    .all(from, to);
}

export function stockMovementReport(from: string, to: string, itemId?: string) {
  let sql = `SELECT im.*, ii.name as item_name FROM inventory_movements im
             JOIN inventory_items ii ON ii.id = im.inventory_item_id
             WHERE im.business_date BETWEEN ? AND ?`;
  const params: unknown[] = [from, to];
  if (itemId) {
    sql += " AND im.inventory_item_id = ?";
    params.push(itemId);
  }
  sql += " ORDER BY im.created_at DESC";
  return db.prepare(sql).all(...params);
}

export function wastageReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT wr.*, ii.name as item_name FROM wastage_records wr
       JOIN inventory_items ii ON ii.id = wr.inventory_item_id
       WHERE wr.business_date BETWEEN ? AND ? ORDER BY wr.business_date DESC`
    )
    .all(from, to);
}

export function bestSellingItemsReport(from: string, to: string, limit = 10) {
  return itemWiseSalesReport(from, to).slice(0, limit);
}

export function highestProfitItemsReport(from: string, to: string, limit = 10) {
  return [...itemWiseSalesReport(from, to)].sort((a, b) => b.gross_profit_paise - a.gross_profit_paise).slice(0, limit);
}

/**
 * Ranks items by quantity sold using the paper-register data transcribed
 * into historical_item_sales (4-10 & 12 Sept 2026) — the only item-level
 * sales history that exists before the app's own POS orders took over.
 */
export function topSellingItemsRegisterReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT item_name, category,
              COUNT(DISTINCT business_date) as days_sold,
              ROUND(SUM(qty_equivalent), 2) as qty_sold_full_equivalent
       FROM historical_item_sales
       WHERE business_date BETWEEN ? AND ?
       GROUP BY item_name, category
       ORDER BY qty_sold_full_equivalent DESC`
    )
    .all(from, to);
}

/**
 * Ranks inventory items by real purchase spend (excludes VOID purchase
 * orders) — answers "what am I buying the most of / spending the most
 * money on".
 */
export function topPurchasedItemsReport(from: string, to: string) {
  return db
    .prepare(
      `SELECT ii.name as item_name, ii.category,
              COUNT(DISTINCT po.id) as purchase_count,
              SUM(pi.quantity_base) as qty_base,
              ii.base_unit,
              COALESCE(SUM(pi.amount_paise), 0) as total_spend_paise
       FROM purchase_items pi
       JOIN purchase_orders po ON po.id = pi.purchase_order_id
       JOIN inventory_items ii ON ii.id = pi.inventory_item_id
       WHERE po.business_date BETWEEN ? AND ? AND po.status != 'VOID'
       GROUP BY ii.id
       ORDER BY total_spend_paise DESC`
    )
    .all(from, to);
}

/**
 * Theoretical per-item profitability from the menu price and current
 * recipe cost — works even with zero sales yet (unlike itemWiseSalesReport,
 * which needs real completed orders). Cost is computed from the CURRENT
 * weighted-average ingredient cost, not a historical snapshot.
 */
export function menuItemProfitabilityReport() {
  const rows = db
    .prepare(
      `SELECT mi.id as menu_item_id, mi.name as item_name, mc.name as category, mp.price_type, mp.price_paise
       FROM menu_items mi
       JOIN menu_categories mc ON mc.id = mi.category_id
       JOIN menu_prices mp ON mp.menu_item_id = mi.id
       WHERE mi.status = 'ACTIVE'
       ORDER BY mc.name, mi.name, mp.price_type`
    )
    .all() as { menu_item_id: string; item_name: string; category: string; price_type: string; price_paise: number }[];

  const costStmt = db.prepare(
    `SELECT SUM(ri.quantity_base * ii.avg_cost_paise_per_base) as cost_paise, COUNT(*) as ingredient_count,
            SUM(ii.price_pending) as pending_ingredients
     FROM recipe_versions rv
     JOIN recipe_items ri ON ri.recipe_version_id = rv.id
     JOIN inventory_items ii ON ii.id = ri.inventory_item_id
     WHERE rv.menu_item_id = ? AND rv.price_type = ? AND rv.effective_to IS NULL`
  );

  return rows.map((r) => {
    const cost = costStmt.get(r.menu_item_id, r.price_type) as
      | { cost_paise: number | null; ingredient_count: number; pending_ingredients: number }
      | undefined;
    const hasRecipe = !!cost && cost.ingredient_count > 0;
    const recipeCostPaise = hasRecipe ? Math.round(cost!.cost_paise ?? 0) : null;
    const profitPaise = recipeCostPaise != null ? r.price_paise - recipeCostPaise : null;
    return {
      category: r.category,
      item_name: r.item_name,
      price_type: r.price_type,
      price_paise: r.price_paise,
      recipe_status: !hasRecipe ? "MISSING" : cost!.pending_ingredients > 0 ? "INCOMPLETE" : "READY",
      recipe_cost_paise: recipeCostPaise,
      profit_paise: profitPaise,
      margin_pct: profitPaise != null ? Math.round((profitPaise / r.price_paise) * 1000) / 10 : null,
    };
  });
}

export function lowStockReport() {
  return db
    .prepare(
      `SELECT * FROM inventory_items WHERE active = 1 AND current_qty_base <= reorder_level_base ORDER BY current_qty_base ASC`
    )
    .all();
}

export function auditReport(filters: { entityType?: string; userId?: string; from?: string; to?: string; limit?: number }) {
  let sql = "SELECT al.*, u.username, u.full_name FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id WHERE 1=1";
  const params: unknown[] = [];
  if (filters.entityType) {
    sql += " AND al.entity_type = ?";
    params.push(filters.entityType);
  }
  if (filters.userId) {
    sql += " AND al.user_id = ?";
    params.push(filters.userId);
  }
  if (filters.from && filters.to) {
    sql += " AND al.created_at BETWEEN ? AND ?";
    params.push(filters.from, filters.to + "T23:59:59.999Z");
  }
  sql += " ORDER BY al.created_at DESC LIMIT ?";
  params.push(filters.limit ?? 200);
  return db.prepare(sql).all(...params);
}
