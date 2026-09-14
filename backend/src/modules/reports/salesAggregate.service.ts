import { db } from "../../db/connection";

export interface SalesSummary {
  orderCount: number;
  grossSalesPaise: number;
  discountsPaise: number;
  netSalesPaise: number;
  cogsPaise: number;
  paymentBreakdown: { paymentMethodId: string; paymentMethodName: string; amountPaise: number }[];
  cashPaise: number;
  onlinePaise: number;
}

/**
 * Aggregates COMPLETED orders only (RULE 2: cancelled orders are never
 * counted as sales). Net sales = gross - discount. COGS is summed from the
 * cogs_paise recorded on each order line at consumption time, so it always
 * reflects the recipe/cost that was actually in effect for that sale.
 */
export function getSalesSummary(fromDate: string, toDate: string): SalesSummary {
  const orderRow = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(subtotal_paise),0) as gross,
              COALESCE(SUM(discount_paise + item_discount_total_paise),0) as disc, COALESCE(SUM(net_total_paise),0) as net
       FROM sales_orders WHERE business_date BETWEEN ? AND ? AND status = 'COMPLETED'`
    )
    .get(fromDate, toDate) as { cnt: number; gross: number; disc: number; net: number };

  const cogsRow = db
    .prepare(
      `SELECT COALESCE(SUM(soi.cogs_paise),0) as cogs
       FROM sales_order_items soi
       JOIN sales_orders so ON so.id = soi.sales_order_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED'`
    )
    .get(fromDate, toDate) as { cogs: number };

  const paymentRows = db
    .prepare(
      `SELECT pm.id as paymentMethodId, pm.name as paymentMethodName, pm.type as type,
              COALESCE(SUM(p.amount_paise),0) as amountPaise
       FROM payments p
       JOIN payment_methods pm ON pm.id = p.payment_method_id
       JOIN sales_orders so ON so.id = p.sales_order_id
       WHERE so.business_date BETWEEN ? AND ? AND so.status = 'COMPLETED' AND p.status = 'ACTIVE'
       GROUP BY pm.id`
    )
    .all(fromDate, toDate) as { paymentMethodId: string; paymentMethodName: string; type: string; amountPaise: number }[];

  const cashPaise = paymentRows.filter((p) => p.type === "CASH").reduce((s, p) => s + p.amountPaise, 0);
  const onlinePaise = paymentRows.filter((p) => p.type === "ONLINE").reduce((s, p) => s + p.amountPaise, 0);

  return {
    orderCount: orderRow.cnt,
    grossSalesPaise: orderRow.gross,
    discountsPaise: orderRow.disc,
    netSalesPaise: orderRow.net,
    cogsPaise: cogsRow.cogs,
    paymentBreakdown: paymentRows.map(({ paymentMethodId, paymentMethodName, amountPaise }) => ({
      paymentMethodId,
      paymentMethodName,
      amountPaise,
    })),
    cashPaise,
    onlinePaise,
  };
}

export function getExpensesTotal(fromDate: string, toDate: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount_paise),0) as total FROM expenses
       WHERE business_date BETWEEN ? AND ? AND status = 'RECORDED'`
    )
    .get(fromDate, toDate) as { total: number };
  return row.total;
}
