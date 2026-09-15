import {
  AuditLog,
  Expense,
  HistoricalItemSale,
  InventoryItem,
  InventoryMovement,
  MenuCategory,
  MenuItem,
  MenuPrice,
  Order,
  PaymentMethod,
  Purchase,
  RecipeVersion,
  Supplier,
  User,
  WastageRecord,
} from "../../db/models";
import { getSalesSummary, getExpensesTotal } from "./salesAggregate.service";

const COMPLETED_IN_RANGE = (from: string, to: string) => ({ businessDate: { $gte: from, $lte: to }, status: "COMPLETED" as const });

export async function dailySalesReport(from: string, to: string) {
  const rows: { _id: string; orders: number; gross_sales_paise: number; discount_paise: number; net_sales_paise: number }[] = await Order.aggregate([
    { $match: COMPLETED_IN_RANGE(from, to) },
    {
      $group: {
        _id: "$businessDate",
        orders: { $sum: 1 },
        gross_sales_paise: { $sum: "$subtotalPaise" },
        discount_paise: { $sum: { $add: ["$discountPaise", "$itemDiscountTotalPaise"] } },
        net_sales_paise: { $sum: "$netTotalPaise" },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const paymentRows: { business_date: string; payment_method_id: string; amount_paise: number }[] = await Order.aggregate([
    { $match: COMPLETED_IN_RANGE(from, to) },
    { $unwind: "$payments" },
    { $match: { "payments.status": "ACTIVE" } },
    { $group: { _id: { date: "$businessDate", methodId: "$payments.paymentMethodId" }, amount_paise: { $sum: "$payments.amountPaise" } } },
    { $project: { _id: 0, business_date: "$_id.date", payment_method_id: "$_id.methodId", amount_paise: 1 } },
  ]);

  const methods = await PaymentMethod.find();
  const methodById = new Map(methods.map((m) => [m._id, m]));

  return rows.map((r) => ({
    business_date: r._id,
    orders: r.orders,
    gross_sales_paise: r.gross_sales_paise,
    discount_paise: r.discount_paise,
    net_sales_paise: r.net_sales_paise,
    paymentBreakdown: paymentRows
      .filter((p) => p.business_date === r._id)
      .map((p) => ({
        business_date: p.business_date,
        method_name: methodById.get(p.payment_method_id)?.name ?? "",
        method_type: methodById.get(p.payment_method_id)?.type ?? "CASH",
        amount_paise: p.amount_paise,
      })),
  }));
}

export async function itemWiseSalesReport(from: string, to: string) {
  const rows: { _id: { menuItemId: string; priceType: string }; item_name: string; qty_sold: number; revenue_paise: number; cogs_paise: number }[] =
    await Order.aggregate([
      { $match: COMPLETED_IN_RANGE(from, to) },
      { $unwind: "$items" },
      { $match: { "items.status": "ACTIVE" } },
      {
        $group: {
          _id: { menuItemId: "$items.menuItemId", priceType: "$items.priceType" },
          item_name: { $first: "$items.itemNameSnapshot" },
          qty_sold: { $sum: "$items.quantity" },
          revenue_paise: { $sum: "$items.lineNetPaise" },
          cogs_paise: { $sum: { $ifNull: ["$items.cogsPaise", 0] } },
        },
      },
      { $sort: { revenue_paise: -1 } },
    ]);

  return rows.map((r) => ({
    menu_item_id: r._id.menuItemId,
    item_name: r.item_name,
    price_type: r._id.priceType,
    qty_sold: r.qty_sold,
    revenue_paise: r.revenue_paise,
    cogs_paise: r.cogs_paise,
    gross_profit_paise: r.revenue_paise - r.cogs_paise,
  }));
}

export async function categorySalesReport(from: string, to: string) {
  const rows = await Order.aggregate([
    { $match: COMPLETED_IN_RANGE(from, to) },
    { $unwind: "$items" },
    { $match: { "items.status": "ACTIVE" } },
    {
      $group: {
        _id: { $ifNull: ["$items.categoryName", "Uncategorized"] },
        qty_sold: { $sum: "$items.quantity" },
        revenue_paise: { $sum: "$items.lineNetPaise" },
        cogs_paise: { $sum: { $ifNull: ["$items.cogsPaise", 0] } },
      },
    },
    { $sort: { revenue_paise: -1 } },
  ]);
  return rows.map((r) => ({ category_name: r._id, qty_sold: r.qty_sold, revenue_paise: r.revenue_paise, cogs_paise: r.cogs_paise }));
}

export async function paymentMethodReport(from: string, to: string) {
  const rows: { _id: string; txn_count: number; amount_paise: number }[] = await Order.aggregate([
    { $match: COMPLETED_IN_RANGE(from, to) },
    { $unwind: "$payments" },
    { $match: { "payments.status": "ACTIVE" } },
    { $group: { _id: "$payments.paymentMethodId", txn_count: { $sum: 1 }, amount_paise: { $sum: "$payments.amountPaise" } } },
    { $sort: { amount_paise: -1 } },
  ]);
  const methods = await PaymentMethod.find({ _id: { $in: rows.map((r) => r._id) } });
  const byId = new Map(methods.map((m) => [m._id, m]));
  return rows.map((r) => ({
    method_name: byId.get(r._id)?.name ?? "",
    method_type: byId.get(r._id)?.type ?? "CASH",
    txn_count: r.txn_count,
    amount_paise: r.amount_paise,
  }));
}

export async function profitLossReport(from: string, to: string) {
  const sales = await getSalesSummary(from, to);
  const expenses = await getExpensesTotal(from, to);
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

export async function inventoryValuationReport() {
  const docs = await InventoryItem.find({ active: true });
  return docs
    .map((d) => ({
      id: d._id,
      name: d.name,
      category: d.category,
      base_unit: d.baseUnit,
      current_qty_base: d.currentQtyBase,
      avg_cost_paise_per_base: d.avgCostPaisePerBase,
      value_paise: Math.round(d.currentQtyBase * d.avgCostPaisePerBase),
      price_pending: d.pricePending ? 1 : 0,
    }))
    .sort((a, b) => b.value_paise - a.value_paise);
}

export async function purchaseReport(from: string, to: string) {
  const docs = await Purchase.find({ businessDate: { $gte: from, $lte: to } }).sort({ businessDate: -1 });
  const supplierIds = [...new Set(docs.map((d) => d.supplierId).filter((x): x is string => !!x))];
  const suppliers = await Supplier.find({ _id: { $in: supplierIds } });
  const byId = new Map(suppliers.map((s) => [s._id, s.name]));
  return docs.map((d) => ({
    id: d._id,
    purchase_number: d.purchaseNumber,
    supplier_id: d.supplierId,
    supplier_name: d.supplierId ? byId.get(d.supplierId) ?? "" : null,
    business_date: d.businessDate,
    payment_status: d.paymentStatus,
    total_paise: d.totalPaise,
    amount_paid_paise: d.amountPaidPaise,
    status: d.status,
  }));
}

export async function expenseReport(from: string, to: string) {
  const rows = await Expense.aggregate([
    { $match: { businessDate: { $gte: from, $lte: to }, status: "RECORDED" } },
    { $group: { _id: "$category", count: { $sum: 1 }, total_paise: { $sum: "$amountPaise" } } },
    { $sort: { total_paise: -1 } },
  ]);
  return rows.map((r) => ({ category: r._id, count: r.count, total_paise: r.total_paise }));
}

export async function stockMovementReport(from: string, to: string, itemId?: string) {
  const query: Record<string, unknown> = { businessDate: { $gte: from, $lte: to } };
  if (itemId) query.inventoryItemId = itemId;
  const docs = await InventoryMovement.find(query).sort({ createdAt: -1 });
  const items = await InventoryItem.find({ _id: { $in: [...new Set(docs.map((d) => d.inventoryItemId))] } });
  const byId = new Map(items.map((i) => [i._id, i.name]));
  return docs.map((d) => ({
    id: d._id,
    inventory_item_id: d.inventoryItemId,
    item_name: byId.get(d.inventoryItemId) ?? "",
    movement_type: d.movementType,
    direction: d.direction,
    quantity_base: d.quantityBase,
    total_cost_paise: d.totalCostPaise,
    business_date: d.businessDate,
    created_at: d.createdAt,
  }));
}

export async function wastageReport(from: string, to: string) {
  const docs = await WastageRecord.find({ businessDate: { $gte: from, $lte: to } }).sort({ businessDate: -1 });
  const items = await InventoryItem.find({ _id: { $in: [...new Set(docs.map((d) => d.inventoryItemId))] } });
  const byId = new Map(items.map((i) => [i._id, i.name]));
  return docs.map((d) => ({
    id: d._id,
    inventory_item_id: d.inventoryItemId,
    item_name: byId.get(d.inventoryItemId) ?? "",
    quantity_base: d.quantityBase,
    total_cost_paise: d.totalCostPaise,
    wastage_type: d.wastageType,
    reason: d.reason,
    business_date: d.businessDate,
  }));
}

export async function bestSellingItemsReport(from: string, to: string, limit = 10) {
  return (await itemWiseSalesReport(from, to)).slice(0, limit);
}

export async function highestProfitItemsReport(from: string, to: string, limit = 10) {
  return [...(await itemWiseSalesReport(from, to))].sort((a, b) => b.gross_profit_paise - a.gross_profit_paise).slice(0, limit);
}

/**
 * Ranks items by quantity sold using the paper-register data transcribed
 * into historical_item_sales (4-10 & 12 Sept 2026) — the only item-level
 * sales history that exists before the app's own POS orders took over.
 */
export async function topSellingItemsRegisterReport(from: string, to: string) {
  const rows = await HistoricalItemSale.aggregate([
    { $match: { businessDate: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { itemName: "$itemName", category: "$category" },
        days_sold: { $addToSet: "$businessDate" },
        qty_sold_full_equivalent: { $sum: "$qtyEquivalent" },
      },
    },
    { $project: { item_name: "$_id.itemName", category: "$_id.category", days_sold: { $size: "$days_sold" }, qty_sold_full_equivalent: { $round: ["$qty_sold_full_equivalent", 2] } } },
    { $sort: { qty_sold_full_equivalent: -1 } },
  ]);
  return rows;
}

/**
 * Ranks inventory items by real purchase spend (excludes VOID purchase
 * orders) — answers "what am I buying the most of / spending the most
 * money on".
 */
export async function topPurchasedItemsReport(from: string, to: string) {
  const purchases = await Purchase.find({ businessDate: { $gte: from, $lte: to }, status: { $ne: "VOID" } });
  const totals = new Map<string, { purchaseIds: Set<string>; qtyBase: number; spendPaise: number }>();
  for (const p of purchases) {
    for (const item of p.purchaseItems) {
      const entry = totals.get(item.inventoryItemId) ?? { purchaseIds: new Set(), qtyBase: 0, spendPaise: 0 };
      entry.purchaseIds.add(p._id);
      entry.qtyBase += item.quantityBase;
      entry.spendPaise += item.amountPaise ?? 0;
      totals.set(item.inventoryItemId, entry);
    }
  }
  const items = await InventoryItem.find({ _id: { $in: [...totals.keys()] } });
  return items
    .map((i) => {
      const t = totals.get(i._id)!;
      return {
        item_name: i.name,
        category: i.category,
        purchase_count: t.purchaseIds.size,
        qty_base: t.qtyBase,
        base_unit: i.baseUnit,
        total_spend_paise: t.spendPaise,
      };
    })
    .sort((a, b) => b.total_spend_paise - a.total_spend_paise);
}

/**
 * Theoretical per-item profitability from the menu price and current
 * recipe cost — works even with zero sales yet (unlike itemWiseSalesReport,
 * which needs real completed orders). Cost is computed from the CURRENT
 * weighted-average ingredient cost, not a historical snapshot.
 */
export async function menuItemProfitabilityReport() {
  const activeItems = await MenuItem.find({ status: "ACTIVE" });
  const categories = await MenuCategory.find();
  const categoryById = new Map(categories.map((c) => [c._id, c.name]));
  const prices = await MenuPrice.find({ menuItemId: { $in: activeItems.map((i) => i._id) }, effectiveTo: null });

  const inventoryCache = new Map<string, { avgCostPaisePerBase: number; pricePending: boolean }>();
  async function getInvCached(id: string) {
    if (!inventoryCache.has(id)) {
      const doc = await InventoryItem.findById(id);
      inventoryCache.set(id, { avgCostPaisePerBase: doc?.avgCostPaisePerBase ?? 0, pricePending: !!doc?.pricePending });
    }
    return inventoryCache.get(id)!;
  }

  const results = [];
  for (const item of activeItems) {
    const itemPrices = prices.filter((p) => p.menuItemId === item._id);
    for (const price of itemPrices) {
      const recipeVersion = await RecipeVersion.findOne({ menuItemId: item._id, priceType: price.priceType, effectiveTo: null });
      const hasRecipe = !!recipeVersion && recipeVersion.recipeItems.length > 0;

      let recipeCostPaise: number | null = null;
      let pendingIngredients = 0;
      if (hasRecipe) {
        let cost = 0;
        for (const ri of recipeVersion!.recipeItems) {
          const inv = await getInvCached(ri.inventoryItemId);
          cost += ri.quantityBase * inv.avgCostPaisePerBase;
          if (inv.pricePending) pendingIngredients += 1;
        }
        recipeCostPaise = Math.round(cost);
      }

      const profitPaise = recipeCostPaise != null ? price.pricePaise - recipeCostPaise : null;
      results.push({
        category: categoryById.get(item.categoryId) ?? "",
        item_name: item.name,
        price_type: price.priceType,
        price_paise: price.pricePaise,
        recipe_status: !hasRecipe ? "MISSING" : pendingIngredients > 0 ? "INCOMPLETE" : "READY",
        recipe_cost_paise: recipeCostPaise,
        profit_paise: profitPaise,
        margin_pct: profitPaise != null ? Math.round((profitPaise / price.pricePaise) * 1000) / 10 : null,
      });
    }
  }

  return results;
}

export async function lowStockReport() {
  const docs = await InventoryItem.find({ active: true });
  return docs
    .filter((d) => d.currentQtyBase <= d.reorderLevelBase)
    .sort((a, b) => a.currentQtyBase - b.currentQtyBase)
    .map((d) => ({
      id: d._id,
      name: d.name,
      category: d.category,
      base_unit: d.baseUnit,
      current_qty_base: d.currentQtyBase,
      reorder_level_base: d.reorderLevelBase,
      min_stock_base: d.minStockBase,
    }));
}

export async function auditReport(filters: { entityType?: string; userId?: string; from?: string; to?: string; limit?: number }) {
  const query: Record<string, unknown> = {};
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.userId) query.userId = filters.userId;
  if (filters.from && filters.to) query.createdAt = { $gte: filters.from, $lte: filters.to + "T23:59:59.999Z" };

  const docs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(filters.limit ?? 200);
  const userIds = [...new Set(docs.map((d) => d.userId).filter((x): x is string => !!x))];
  const users = await User.find({ _id: { $in: userIds } });
  const byId = new Map(users.map((u) => [u._id, u]));

  return docs.map((d) => ({
    id: d._id,
    user_id: d.userId,
    username: d.userId ? byId.get(d.userId)?.username : undefined,
    full_name: d.userId ? byId.get(d.userId)?.fullName : undefined,
    action: d.action,
    entity_type: d.entityType,
    entity_id: d.entityId,
    old_value: d.oldValue,
    new_value: d.newValue,
    reason: d.reason,
    created_at: d.createdAt,
  }));
}
