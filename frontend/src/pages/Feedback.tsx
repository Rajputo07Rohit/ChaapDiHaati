import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { api } from "../api/client";
import { Badge, Card, EmptyState, PageHeader } from "../components/ui/Primitives";
import { formatPaise } from "../utils/money";

interface FeedbackRow {
  order_id: string;
  order_number: number;
  customer_name: string | null;
  phone: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface PaymentIssue {
  id: string;
  phone: string;
  customer_name: string | null;
  amount_paise: number;
  status: "REFUNDED" | "REFUND_FAILED";
  reason: string | null;
  created_at: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={14} className={i <= n ? "fill-amber-400 text-amber-400" : "text-slate-300"} />
      ))}
    </span>
  );
}

/** What customers privately said about their orders, and online payments that couldn't become an order. */
export function Feedback() {
  const { data } = useQuery({
    queryKey: ["feedback"],
    queryFn: () => api.get<{ average: number | null; count: number; feedback: FeedbackRow[] }>("/feedback"),
    refetchInterval: 60_000,
  });
  const { data: issues } = useQuery({
    queryKey: ["payment-issues"],
    queryFn: () => api.get<{ checkouts: PaymentIssue[] }>("/feedback/payment-issues"),
    refetchInterval: 60_000,
  });

  const rows = data?.feedback ?? [];
  const failed = (issues?.checkouts ?? []).filter((c) => c.status === "REFUND_FAILED");

  return (
    <div>
      <PageHeader
        title="Customer Feedback"
        description="Private ratings customers give their finished orders in the app. Low ratings are worth a call."
      />

      {failed.length > 0 && (
        <Card className="mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">
            {failed.length} online payment{failed.length > 1 ? "s" : ""} could not be refunded automatically
          </p>
          <p className="mt-1">These customers paid but no order could be placed. The system keeps retrying; if it doesn't clear, refund them from the Cashfree dashboard.</p>
        </Card>
      )}

      <div className="mb-6 flex gap-4">
        <Card className="p-4">
          <div className="text-xs text-slate-500">Average rating</div>
          <div className="mt-1 text-2xl font-semibold">{data?.average ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-slate-500">Ratings</div>
          <div className="mt-1 text-2xl font-semibold">{data?.count ?? 0}</div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No ratings yet" description="Customers can rate an order from the app once it's delivered or completed." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">When</th>
                <th className="px-4 py-2.5 text-left">Order</th>
                <th className="px-4 py-2.5 text-left">Customer</th>
                <th className="px-4 py-2.5 text-left">Rating</th>
                <th className="px-4 py-2.5 text-left">Comment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((f) => (
                <tr key={f.order_id} className={f.rating <= 2 ? "bg-rose-50/50" : ""}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{when(f.created_at)}</td>
                  <td className="px-4 py-2.5 font-medium">#{f.order_number}</td>
                  <td className="px-4 py-2.5">
                    {f.customer_name ?? "—"}
                    <a href={`tel:${f.phone}`} className="ml-2 text-xs text-blue-600">
                      {f.phone}
                    </a>
                  </td>
                  <td className="px-4 py-2.5">
                    <Stars n={f.rating} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-600">{f.comment ?? <span className="text-slate-300">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">Online payments that couldn't become an order</h2>
      <Card className="overflow-hidden">
        {(issues?.checkouts ?? []).length === 0 ? (
          <EmptyState title="None" description="Every online payment has turned into an order." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2.5 text-left">When</th>
                <th className="px-4 py-2.5 text-left">Customer</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                <th className="px-4 py-2.5 text-left">Why</th>
                <th className="px-4 py-2.5 text-left">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {issues!.checkouts.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap px-4 py-2.5 text-slate-500">{when(c.created_at)}</td>
                  <td className="px-4 py-2.5">
                    {c.customer_name ?? "—"} <span className="text-xs text-slate-400">{c.phone}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(c.amount_paise)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{c.reason ?? "—"}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={c.status === "REFUNDED" ? "green" : "red"}>{c.status === "REFUNDED" ? "Refunded" : "Refund failed"}</Badge>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-400">{c.id}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
