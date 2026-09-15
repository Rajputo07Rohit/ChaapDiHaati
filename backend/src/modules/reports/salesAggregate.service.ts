import { Expense, Order, PaymentMethod } from "../../db/models";

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
export async function getSalesSummary(fromDate: string, toDate: string): Promise<SalesSummary> {
  const match = { businessDate: { $gte: fromDate, $lte: toDate }, status: "COMPLETED" as const };

  const [orderAgg] = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        cnt: { $sum: 1 },
        gross: { $sum: "$subtotalPaise" },
        disc: { $sum: { $add: ["$discountPaise", "$itemDiscountTotalPaise"] } },
        net: { $sum: "$netTotalPaise" },
      },
    },
  ]);

  const [cogsAgg] = await Order.aggregate([
    { $match: match },
    { $unwind: "$items" },
    { $group: { _id: null, cogs: { $sum: { $ifNull: ["$items.cogsPaise", 0] } } } },
  ]);

  const paymentAgg: { _id: string; amountPaise: number }[] = await Order.aggregate([
    { $match: match },
    { $unwind: "$payments" },
    { $match: { "payments.status": "ACTIVE" } },
    { $group: { _id: "$payments.paymentMethodId", amountPaise: { $sum: "$payments.amountPaise" } } },
  ]);

  const methods = await PaymentMethod.find({ _id: { $in: paymentAgg.map((p) => p._id) } });
  const methodById = new Map(methods.map((m) => [m._id, m]));

  const paymentBreakdown = paymentAgg.map((p) => ({
    paymentMethodId: p._id,
    paymentMethodName: methodById.get(p._id)?.name ?? "",
    amountPaise: p.amountPaise,
  }));

  const cashPaise = paymentAgg.filter((p) => methodById.get(p._id)?.type === "CASH").reduce((s, p) => s + p.amountPaise, 0);
  const onlinePaise = paymentAgg.filter((p) => methodById.get(p._id)?.type === "ONLINE").reduce((s, p) => s + p.amountPaise, 0);

  return {
    orderCount: orderAgg?.cnt ?? 0,
    grossSalesPaise: orderAgg?.gross ?? 0,
    discountsPaise: orderAgg?.disc ?? 0,
    netSalesPaise: orderAgg?.net ?? 0,
    cogsPaise: cogsAgg?.cogs ?? 0,
    paymentBreakdown,
    cashPaise,
    onlinePaise,
  };
}

export async function getExpensesTotal(fromDate: string, toDate: string): Promise<number> {
  const [agg] = await Expense.aggregate([
    { $match: { businessDate: { $gte: fromDate, $lte: toDate }, status: "RECORDED" } },
    { $group: { _id: null, total: { $sum: "$amountPaise" } } },
  ]);
  return agg?.total ?? 0;
}
