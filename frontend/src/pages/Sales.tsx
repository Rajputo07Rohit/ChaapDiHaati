import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatPaise } from "../utils/money";
import { Card, EmptyState, Input, PageHeader } from "../components/ui/Primitives";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function Sales() {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(today());

  const { data: daily } = useQuery({
    queryKey: ["sales-daily", from, to],
    queryFn: () => api.get<{ rows: any[] }>(`/reports/sales/daily?from=${from}&to=${to}`),
  });
  const { data: itemWise } = useQuery({
    queryKey: ["sales-item-wise", from, to],
    queryFn: () => api.get<{ rows: any[] }>(`/reports/sales/item-wise?from=${from}&to=${to}`),
  });

  const totalNet = (daily?.rows ?? []).reduce((s, r) => s + r.net_sales_paise, 0);
  const totalOrders = (daily?.rows ?? []).reduce((s, r) => s + r.orders, 0);

  return (
    <div>
      <PageHeader
        title="Sales"
        description="Automatically aggregated from completed orders."
        actions={
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase">Net Sales</div>
          <div className="text-xl font-semibold mt-1">{formatPaise(totalNet)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase">Orders</div>
          <div className="text-xl font-semibold mt-1">{totalOrders}</div>
        </Card>
      </div>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Daily Sales</h2>
      <Card className="overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Orders</th>
                <th className="text-right px-4 py-2.5">Gross</th>
                <th className="text-right px-4 py-2.5">Discount</th>
                <th className="text-right px-4 py-2.5">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(daily?.rows ?? []).map((r) => (
                <tr key={r.business_date}>
                  <td className="px-4 py-2.5">{r.business_date}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.orders}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(r.gross_sales_paise)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(r.discount_paise)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatPaise(r.net_sales_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(daily?.rows.length ?? 0) === 0 && <EmptyState title="No sales in this range" description="Try widening the date range." />}
        </div>
      </Card>

      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Item-wise Sales</h2>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Item</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-right px-4 py-2.5">Qty</th>
                <th className="text-right px-4 py-2.5">Revenue</th>
                <th className="text-right px-4 py-2.5">COGS</th>
                <th className="text-right px-4 py-2.5">Gross Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(itemWise?.rows ?? []).map((r, idx) => (
                <tr key={idx}>
                  <td className="px-4 py-2.5">{r.item_name}</td>
                  <td className="px-4 py-2.5 text-slate-400">{r.price_type}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.qty_sold}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(r.revenue_paise)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(r.cogs_paise)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatPaise(r.gross_profit_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
