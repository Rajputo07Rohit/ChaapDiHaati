import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { api } from "../api/client";
import { Button, Card, Input, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthStart() {
  return today().slice(0, 7) + "-01";
}

const REPORTS: { value: string; label: string; needsRange: boolean; adminOnly?: boolean }[] = [
  { value: "sales/category", label: "Category Sales", needsRange: true },
  { value: "sales/payment-method", label: "Payment Method Report", needsRange: true },
  { value: "inventory-valuation", label: "Inventory Valuation", needsRange: false },
  { value: "purchases", label: "Purchase Report", needsRange: true },
  { value: "expenses", label: "Expense Report", needsRange: true },
  { value: "stock-movement", label: "Stock Movement", needsRange: true },
  { value: "wastage", label: "Wastage Report", needsRange: true },
  { value: "best-selling", label: "Best-Selling Items", needsRange: true },
  { value: "top-selling-register", label: "Top-Selling Items (Register, 4-12 Sept)", needsRange: true },
  { value: "top-purchased", label: "Top-Purchased Items (Investment)", needsRange: true },
  { value: "menu-profitability", label: "Menu Item Profitability (Price vs Cost)", needsRange: false, adminOnly: true },
  { value: "highest-profit", label: "Highest-Profit Items", needsRange: true },
  { value: "low-stock", label: "Low-Stock Report", needsRange: false },
];

function formatCell(key: string, value: unknown): string {
  if (value == null) return "—";
  if (key.toLowerCase().includes("paise")) return `₹${((value as number) / 100).toLocaleString()}`;
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function csvCell(key: string, value: unknown): string {
  if (value == null) return "";
  const raw = key.toLowerCase().includes("paise") ? (value as number) / 100 : value;
  const s = String(raw);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadReportCsv(reportLabel: string, columns: string[], rows: Record<string, unknown>[]) {
  const header = columns.map((c) => c.replace(/_/g, " ")).join(",");
  const body = rows.map((row) => columns.map((c) => csvCell(c, row[c])).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${reportLabel.replace(/\s+/g, "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const visibleReports = REPORTS.filter((r) => !r.adminOnly || isAdmin);

  const [report, setReport] = useState(REPORTS[0].value);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());

  const meta = visibleReports.find((r) => r.value === report) ?? visibleReports[0];
  const url = meta.needsRange ? `/reports/${meta.value}?from=${from}&to=${to}` : `/reports/${meta.value}`;

  const { data, isLoading } = useQuery({ queryKey: ["report", meta.value, from, to], queryFn: () => api.get<{ rows: Record<string, unknown>[] }>(url) });

  const rows = data?.rows ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <PageHeader
        title="Reports"
        actions={
          <>
            <Select value={meta.value} onChange={(e) => setReport(e.target.value)}>
              {visibleReports.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
            {meta.needsRange && (
              <>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            <Button variant="secondary" disabled={rows.length === 0} onClick={() => downloadReportCsv(meta.label, columns, rows)}>
              <Download size={14} /> Export CSV
            </Button>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="text-left px-4 py-2.5 whitespace-nowrap">
                    {c.replace(/_/g, " ")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  {columns.map((c) => (
                    <td key={c} className="px-4 py-2.5 whitespace-nowrap">
                      {formatCell(c, row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && rows.length === 0 && <p className="text-center text-slate-400 py-8">No data for this range.</p>}
        </div>
      </Card>
    </div>
  );
}
