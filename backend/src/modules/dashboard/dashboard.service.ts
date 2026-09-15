import { todayBusinessDate } from "../../utils/ids";
import { getSalesSummary, getExpensesTotal } from "../reports/salesAggregate.service";
import { getCashLedgerSummary } from "../cash/cash.service";
import { getBankBalancePaise, getBankReconciliationStatus } from "../bank/bank.service";
import { getStockValuePaise, getLowStockItems } from "../inventory/inventory.service";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + "-01";
}

export async function getDashboard() {
  const today = todayBusinessDate();

  const todaySales = await getSalesSummary(today, today);
  const todayExpenses = await getExpensesTotal(today, today);
  const todayGrossProfit = todaySales.netSalesPaise - todaySales.cogsPaise;
  const todayNetProfit = todayGrossProfit - todayExpenses;
  const avgOrderValue = todaySales.orderCount > 0 ? Math.round(todaySales.netSalesPaise / todaySales.orderCount) : 0;

  const cash = await getCashLedgerSummary(today);
  const bankBalance = await getBankBalancePaise(today);
  const stockValue = await getStockValuePaise();
  const lowStock = await getLowStockItems();

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const sales = await getSalesSummary(date, date);
    const expenses = await getExpensesTotal(date, date);
    const grossProfit = sales.netSalesPaise - sales.cogsPaise;
    last7.push({
      date,
      netSalesPaise: sales.netSalesPaise,
      ordersCount: sales.orderCount,
      cashPaise: sales.cashPaise,
      onlinePaise: sales.onlinePaise,
      grossProfitPaise: grossProfit,
      netProfitPaise: grossProfit - expenses,
    });
  }

  const mtdFrom = monthStart(today);
  const mtdSales = await getSalesSummary(mtdFrom, today);
  const mtdExpenses = await getExpensesTotal(mtdFrom, today);
  const mtdGrossProfit = mtdSales.netSalesPaise - mtdSales.cogsPaise;

  return {
    today: {
      grossSalesPaise: todaySales.grossSalesPaise,
      discountsPaise: todaySales.discountsPaise,
      netSalesPaise: todaySales.netSalesPaise,
      cashSalesPaise: todaySales.cashPaise,
      onlineSalesPaise: todaySales.onlinePaise,
      orderCount: todaySales.orderCount,
      avgOrderValuePaise: avgOrderValue,
      cogsPaise: todaySales.cogsPaise,
      grossProfitPaise: todayGrossProfit,
      expensesPaise: todayExpenses,
      netProfitPaise: todayNetProfit,
      cashAvailablePaise: cash.expectedCashPaise,
      bankLedgerBalancePaise: bankBalance,
      bankReconciliation: await getBankReconciliationStatus(),
      lowStockCount: lowStock.filter((i) => i.stockStatus === "LOW" || i.stockStatus === "CRITICAL").length,
      outOfStockCount: lowStock.filter((i) => i.stockStatus === "OUT_OF_STOCK").length,
    },
    last7Days: last7,
    mtd: {
      salesPaise: mtdSales.netSalesPaise,
      expensesPaise: mtdExpenses,
      cogsPaise: mtdSales.cogsPaise,
      grossProfitPaise: mtdGrossProfit,
      netProfitPaise: mtdGrossProfit - mtdExpenses,
    },
    stockValuePaise: stockValue,
    lowStockItems: lowStock.slice(0, 15),
  };
}
