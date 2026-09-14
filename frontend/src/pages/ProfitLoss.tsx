import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { formatPaise } from "../utils/money";
import { Card, Input, PageHeader } from "../components/ui/Primitives";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthStart() {
  return today().slice(0, 7) + "-01";
}

interface PL {
  grossSalesPaise: number;
  discountsPaise: number;
  netSalesPaise: number;
  cogsPaise: number;
  grossProfitPaise: number;
  expensesPaise: number;
  netProfitPaise: number;
  foodCostPct: number;
  grossMarginPct: number;
  netMarginPct: number;
}

function Row({ label, value, bold, indent, tone }: { label: string; value: string; bold?: boolean; indent?: boolean; tone?: "positive" | "negative" }) {
  return (
    <div className={`flex justify-between py-2 ${bold ? "font-semibold border-t border-slate-200 mt-1 pt-3" : ""} ${indent ? "pl-4 text-slate-500" : ""}`}>
      <span>{label}</span>
      <span className={`tabular-nums ${tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : ""}`}>{value}</span>
    </div>
  );
}

export function ProfitLoss() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const { data } = useQuery({ queryKey: ["pl", from, to], queryFn: () => api.get<PL>(`/reports/profit-loss?from=${from}&to=${to}`) });

  return (
    <div>
      <PageHeader
        title="Profit & Loss"
        description="Every figure is traceable to a real transaction — never sales minus purchases."
        actions={
          <>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        }
      />

      {data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6">
            <h3 className="font-semibold text-slate-800 mb-2">Statement</h3>
            <div className="divide-y divide-slate-50 text-sm">
              <Row label="Gross Sales (Revenue)" value={formatPaise(data.grossSalesPaise)} />
              <Row label="Discounts" value={`-${formatPaise(data.discountsPaise)}`} indent tone="negative" />
              <Row label="Net Sales" value={formatPaise(data.netSalesPaise)} bold />
              <Row label="Cost of Goods Sold (COGS)" value={`-${formatPaise(data.cogsPaise)}`} indent tone="negative" />
              <Row label="Gross Profit" value={formatPaise(data.grossProfitPaise)} bold tone="positive" />
              <Row label="Operating Expenses" value={`-${formatPaise(data.expensesPaise)}`} indent tone="negative" />
              <Row label="Net Profit" value={formatPaise(data.netProfitPaise)} bold tone={data.netProfitPaise >= 0 ? "positive" : "negative"} />
            </div>
          </Card>
          <Card className="p-6">
            <h3 className="font-semibold text-slate-800 mb-4">Margins</h3>
            <div className="space-y-4">
              <div>
                <div className="text-xs text-slate-500 uppercase">Food Cost %</div>
                <div className="text-2xl font-semibold">{data.foodCostPct.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Gross Margin %</div>
                <div className="text-2xl font-semibold">{data.grossMarginPct.toFixed(2)}%</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 uppercase">Net Margin %</div>
                <div className="text-2xl font-semibold">{data.netMarginPct.toFixed(2)}%</div>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
