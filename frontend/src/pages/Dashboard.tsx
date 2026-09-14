import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { api } from "../api/client";
import { DashboardData } from "../api/types";
import { formatPaise } from "../utils/money";
import { formatQtyShort } from "../utils/units";
import { PageHeader, StatCard, Card, Skeleton, StockBadge } from "../components/ui/Primitives";

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
    refetchInterval: 30_000,
  });

  if (isLoading || !data) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  const { today, last7Days, mtd, stockValuePaise, lowStockItems } = data;
  const chartData = last7Days.map((d) => ({
    date: d.date.slice(5),
    Sales: d.netSalesPaise / 100,
    Profit: d.netProfitPaise / 100,
    Cash: d.cashPaise / 100,
    Online: d.onlinePaise / 100,
    Orders: d.ordersCount,
  }));

  return (
    <div>
      <PageHeader title="Dashboard" description="Today's performance, calculated automatically from real transactions." />

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Today</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard label="Gross Sales" value={formatPaise(today.grossSalesPaise)} sub={`Discounts: ${formatPaise(today.discountsPaise)}`} />
        <StatCard label="Net Sales" value={formatPaise(today.netSalesPaise)} sub={`${today.orderCount} orders · avg ${formatPaise(today.avgOrderValuePaise)}`} />
        <StatCard label="Cash Sales" value={formatPaise(today.cashSalesPaise)} />
        <StatCard label="Online Sales" value={formatPaise(today.onlineSalesPaise)} />
        <StatCard label="Food Cost (COGS)" value={formatPaise(today.cogsPaise)} />
        <StatCard label="Gross Profit" value={formatPaise(today.grossProfitPaise)} tone="positive" />
        <StatCard label="Expenses" value={formatPaise(today.expensesPaise)} />
        <StatCard
          label="Net Profit"
          value={formatPaise(today.netProfitPaise)}
          tone={today.netProfitPaise >= 0 ? "positive" : "negative"}
        />
        <StatCard label="Cash in Hand" value={formatPaise(today.cashAvailablePaise)} />
        <StatCard
          label="Bank Balance (Ledger)"
          value={formatPaise(today.bankLedgerBalancePaise)}
          sub={
            today.bankReconciliation.hasStatement
              ? today.bankReconciliation.reconciliationPending
                ? `Reconciliation pending since ${today.bankReconciliation.statementDate}`
                : "Reconciled with bank statement"
              : "No bank statement confirmed yet"
          }
          tone={today.bankReconciliation.reconciliationPending ? "warning" : "default"}
        />
        <StatCard label="Inventory Value" value={formatPaise(stockValuePaise)} sub="Not liquid money — see Cash & Bank" />
        <StatCard
          label="Stock Alerts"
          value={today.lowStockCount + today.outOfStockCount}
          sub={`${today.outOfStockCount} out of stock · ${today.lowStockCount} low`}
          tone={today.outOfStockCount > 0 ? "negative" : today.lowStockCount > 0 ? "warning" : "default"}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Last 7 Days — Sales & Profit (₹)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
              <Line type="monotone" dataKey="Sales" stroke="#ea580c" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="Profit" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Last 7 Days — Cash vs Online (₹)</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v: number) => `₹${v.toLocaleString()}`} />
              <Bar dataKey="Cash" fill="#3b82f6" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Online" fill="#f97316" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Month to Date</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard label="MTD Sales" value={formatPaise(mtd.salesPaise)} />
        <StatCard label="MTD COGS" value={formatPaise(mtd.cogsPaise)} />
        <StatCard label="MTD Gross Profit" value={formatPaise(mtd.grossProfitPaise)} />
        <StatCard label="MTD Expenses" value={formatPaise(mtd.expensesPaise)} />
        <StatCard label="MTD Net Profit" value={formatPaise(mtd.netProfitPaise)} tone={mtd.netProfitPaise >= 0 ? "positive" : "negative"} />
      </div>

      <Card className="p-4">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Stock Alerts</h3>
        {lowStockItems.length === 0 ? (
          <p className="text-sm text-slate-400">All stock levels healthy.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {lowStockItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between py-2 text-sm">
                <span>{item.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-slate-400 tabular-nums">{formatQtyShort(item.current_qty_base, item.base_unit)}</span>
                  <StockBadge status={item.stockStatus} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
