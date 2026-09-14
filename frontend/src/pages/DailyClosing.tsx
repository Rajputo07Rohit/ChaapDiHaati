import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { Badge, Button, Card, Input, PageHeader } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function DailyClosing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [date, setDate] = useState(today());
  const [actualCash, setActualCash] = useState("");
  const [cashDiffReason, setCashDiffReason] = useState("");
  const [reopenReason, setReopenReason] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["daily-closing", date], queryFn: () => api.get<any>(`/daily-closing?businessDate=${date}`) });

  const openMutation = useMutation({
    mutationFn: () => api.post("/daily-closing/open", { businessDate: date, openingCashPaise: 0 }),
    onSuccess: () => {
      toast.success("Business day opened");
      queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not open day"),
  });

  const closeMutation = useMutation({
    mutationFn: () =>
      api.post("/daily-closing/close", {
        businessDate: date,
        actualCashPaise: rupeesToPaise(parseFloat(actualCash) || 0),
        cashDiffReason: cashDiffReason || undefined,
      }),
    onSuccess: () => {
      toast.success("Day closed");
      queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not close day. If cash differs, a reason is required."),
  });

  const reopenMutation = useMutation({
    mutationFn: () => api.post("/daily-closing/reopen", { businessDate: date, reason: reopenReason }),
    onSuccess: () => {
      toast.success("Day reopened");
      setReopenReason("");
      queryClient.invalidateQueries({ queryKey: ["daily-closing"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not reopen day"),
  });

  const closing = data?.closing;
  const preview = data?.preview;
  const diffPreview = closing?.status === "CLOSED" ? closing.cash_difference_paise : null;

  return (
    <div>
      <PageHeader title="Daily Closing" description="Review the day, then close it. Nothing is corrected silently — differences are recorded with a reason." />

      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mb-6" />

      {!isLoading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">Review — {date}</h3>
              {closing ? (
                <Badge tone={closing.status === "CLOSED" ? "green" : "blue"}>{closing.status}</Badge>
              ) : (
                <Badge tone="gray">NOT OPENED</Badge>
              )}
            </div>
            {preview && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                <Row label="Gross Sales" value={formatPaise(preview.grossSalesPaise)} />
                <Row label="Discounts" value={formatPaise(preview.discountsPaise)} />
                <Row label="Net Sales" value={formatPaise(preview.netSalesPaise)} />
                <Row label="Cash Sales" value={formatPaise(preview.cashPaise)} />
                <Row label="Online Sales" value={formatPaise(preview.onlinePaise)} />
                <Row label="COGS" value={formatPaise(preview.cogsPaise)} />
                <Row label="Gross Profit" value={formatPaise(preview.grossProfitPaise)} />
                <Row label="Expenses" value={formatPaise(preview.expensesPaise)} />
                <Row label="Net Profit" value={formatPaise(preview.netProfitPaise)} />
                <Row label="Expected Cash" value={formatPaise(preview.expectedCashPaise)} />
                <Row label="Bank Balance" value={formatPaise(preview.bankBalancePaise)} />
                <Row label="Stock Value" value={formatPaise(preview.stockValuePaise)} />
              </div>
            )}
          </Card>

          <Card className="p-5">
            {!closing && (
              <>
                <h3 className="font-semibold text-slate-800 mb-3">Open Day</h3>
                <Button className="w-full" onClick={() => openMutation.mutate()} disabled={openMutation.isPending}>
                  {openMutation.isPending ? "Opening…" : `Open ${date}`}
                </Button>
              </>
            )}
            {closing?.status === "OPEN" && (
              <>
                <h3 className="font-semibold text-slate-800 mb-3">Close Day</h3>
                <label className="text-xs text-slate-500">Actual physical cash counted (₹)</label>
                <Input type="number" value={actualCash} onChange={(e) => setActualCash(e.target.value)} className="w-full mb-2" />
                {actualCash && preview && rupeesToPaise(parseFloat(actualCash)) !== preview.expectedCashPaise && (
                  <>
                    <p className="text-xs text-rose-600 mb-2">
                      Difference: {formatPaise(rupeesToPaise(parseFloat(actualCash)) - preview.expectedCashPaise)} — a reason is required.
                    </p>
                    <Input placeholder="Reason for difference" value={cashDiffReason} onChange={(e) => setCashDiffReason(e.target.value)} className="w-full mb-2" />
                  </>
                )}
                <Button className="w-full" onClick={() => closeMutation.mutate()} disabled={!actualCash || closeMutation.isPending}>
                  {closeMutation.isPending ? "Closing…" : `Close ${date}`}
                </Button>
              </>
            )}
            {closing?.status === "CLOSED" && (
              <>
                <h3 className="font-semibold text-slate-800 mb-3">Closed</h3>
                <Row label="Actual Cash" value={formatPaise(closing.actual_cash_paise)} />
                <Row label="Expected Cash" value={formatPaise(closing.expected_cash_paise)} />
                <Row
                  label="Difference"
                  value={formatPaise(diffPreview)}
                />
                {closing.cash_diff_reason && <p className="text-xs text-slate-500 mt-2">{closing.cash_diff_reason}</p>}
                {user?.role === "ADMIN" && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <Input placeholder="Reason to reopen" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="w-full mb-2" />
                    <Button variant="danger" className="w-full" disabled={!reopenReason || reopenMutation.isPending} onClick={() => reopenMutation.mutate()}>
                      {reopenMutation.isPending ? "Reopening…" : "Reopen (Admin)"}
                    </Button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-50 py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="tabular-nums font-medium">{value}</span>
    </div>
  );
}
