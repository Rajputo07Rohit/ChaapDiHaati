import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChefHat, Clock, CheckCircle2, Calendar, MapPin, UtensilsCrossed, Bike } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { PageHeader } from "../components/ui/Primitives";
import { toDdMmYyyy } from "../utils/date";

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
  ONLINE: "Online",
};

const ORDER_TYPE_COLOR: Record<string, string> = {
  DINE_IN: "bg-blue-100 text-blue-700",
  TAKEAWAY: "bg-purple-100 text-purple-700",
  DELIVERY: "bg-orange-100 text-orange-700",
  ONLINE: "bg-teal-100 text-teal-700",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
}

/** Ticks periodically purely to re-render elapsed-time labels — the order
 * data itself is refetched separately on its own interval. */
function useClockTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
}

function OrderTicket({ order }: { order: SalesOrder }) {
  const queryClient = useQueryClient();
  const age = minutesAgo(order.created_at);
  const urgent = order.kitchen_status === "PENDING" && age >= 15;
  const ready = order.kitchen_status === "READY";
  const items = (order.items ?? []).filter((i) => i.status === "ACTIVE");

  // Kitchen prep is tracked independently of the order's own status —
  // a counter sale is often already paid and COMPLETED the instant it's
  // rung up, well before the food is actually cooked. This is the one
  // action the kitchen screen has: flip it to ready.
  const markReadyMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/kitchen-ready`),
    onSuccess: () => {
      toast.success(`Order #${order.order_number} ready`);
      queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update order"),
  });

  return (
    <div
      className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden flex flex-col ${
        ready ? "border-emerald-200 opacity-70" : urgent ? "border-rose-400" : "border-slate-200"
      }`}
    >
      <div className={`flex items-center justify-between px-4 py-3 ${ready ? "bg-emerald-50" : urgent ? "bg-rose-50" : "bg-slate-50"}`}>
        <span className="text-xl font-extrabold text-slate-900">#{order.order_number}</span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase ${
            ready ? "bg-emerald-600 text-white" : urgent ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-600"
          }`}
        >
          <Clock size={12} /> {age === 0 ? "just now" : `${age} min`}
        </span>
      </div>

      <div className="px-4 py-2 border-b border-slate-100 space-y-1.5">
        <div className="flex items-center justify-between">
          <span
            className={`inline-block px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${
              ORDER_TYPE_COLOR[order.order_type] ?? "bg-slate-100 text-slate-600"
            }`}
          >
            {ORDER_TYPE_LABEL[order.order_type] ?? order.order_type}
          </span>
          <span className="text-xs text-slate-400 tabular-nums">{formatTime(order.created_at)}</span>
        </div>
        {order.order_type === "DELIVERY" && order.delivery_address?.trim() && (
          <div className="flex items-start gap-1.5 text-sm text-slate-700">
            <MapPin size={14} className="text-orange-500 shrink-0 mt-0.5" />
            <span className="font-medium">{order.delivery_address}</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2">
            <div>
              <span className="text-base font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-sm text-slate-500"> ({item.price_type})</span>}
              {item.special_instructions && <div className="text-sm text-amber-700 font-medium">Note: {item.special_instructions}</div>}
            </div>
            <span className="text-lg font-extrabold text-brand-600 tabular-nums shrink-0">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {ready ? (
        <div className="w-full flex items-center justify-center gap-1.5 bg-emerald-100 text-emerald-700 font-bold text-base py-3.5">
          <CheckCircle2 size={18} /> Ready
        </div>
      ) : (
        <button
          disabled={markReadyMutation.isPending}
          onClick={() => markReadyMutation.mutate()}
          className="w-full bg-emerald-600 text-white font-bold text-base py-3.5 disabled:opacity-50 [touch-action:manipulation] active:bg-emerald-700"
        >
          {markReadyMutation.isPending ? "Marking Ready…" : "Mark Ready"}
        </button>
      )}
    </div>
  );
}

/** Groups orders by business date (most recent date first, orders within
 * a date oldest-first so the longest-waiting ticket is the first thing
 * the kitchen sees). */
function groupByDate(orders: SalesOrder[]): [string, SalesOrder[]][] {
  const sorted = [...orders].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const groups: [string, SalesOrder[]][] = [];
  for (const o of sorted) {
    const group = groups.find(([d]) => d === o.business_date);
    if (group) group[1].push(o);
    else groups.push([o.business_date, [o]]);
  }
  return groups.sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0));
}

function KitchenSection({
  title,
  icon,
  accent,
  orders,
  emptyLabel,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  orders: SalesOrder[];
  emptyLabel: string;
}) {
  const ordersByDate = groupByDate(orders);

  return (
    <section className="flex-1 min-w-0">
      <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-white font-bold ${accent}`}>
        {icon}
        <span className="text-base">{title}</span>
        <span className="ml-auto text-sm font-semibold bg-white/20 rounded-full px-2.5 py-0.5 tabular-nums">
          {orders.length}
        </span>
      </div>

      {ordersByDate.length === 0 && (
        <div className="text-center text-slate-400 py-14 border border-dashed border-slate-200 rounded-2xl mt-3">
          <ChefHat size={36} className="mx-auto mb-2 opacity-40" />
          <div className="text-sm font-medium">{emptyLabel}</div>
        </div>
      )}

      {ordersByDate.map(([date, dateOrders]) => (
        <Fragment key={date}>
          <div className="flex items-center gap-2 bg-slate-800 text-white text-sm font-bold px-4 py-2 rounded-xl mt-4 first:mt-3">
            <Calendar size={14} />
            {toDdMmYyyy(date)}
            <span className="font-normal text-slate-300">
              · {dateOrders.length} order{dateOrders.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-3">
            {dateOrders.map((o) => (
              <OrderTicket key={o.id} order={o} />
            ))}
          </div>
        </Fragment>
      ))}
    </section>
  );
}

export function Kitchen() {
  useClockTick();
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [showReady, setShowReady] = useState(false);

  // The default (pending-only) view deliberately does NOT restrict to one
  // business date — a PENDING order from an earlier day that never got
  // marked ready must never silently disappear just because "today" moved
  // on. The date picker only applies once "Show ready too" is on, for
  // reviewing one specific day's full history.
  const { data, isLoading } = useQuery({
    queryKey: ["kitchen-orders", showReady, businessDate],
    queryFn: () =>
      api.get<{ orders: SalesOrder[] }>(showReady ? `/orders?businessDate=${businessDate}&limit=300` : `/orders?limit=300`),
    refetchInterval: 10_000,
  });

  // Every order gets kitchen tracking regardless of type/status — a
  // counter sale is typically already COMPLETED by the time it reaches
  // here, so this can't filter on order status at all, only on whether
  // the kitchen itself has marked it ready yet. PENDING_ACCEPTANCE is the
  // one exception: a customer self-order staff hasn't accepted/denied yet
  // must never reach the kitchen board, or cooking could start on an order
  // that gets denied a moment later.
  const filtered = (data?.orders ?? [])
    .filter((o) => o.status !== "CANCELLED" && o.status !== "REFUNDED" && o.status !== "PENDING_ACCEPTANCE")
    .filter((o) => showReady || o.kitchen_status === "PENDING");

  // Dine-in and takeaway are cooked-and-served-on-the-spot; delivery
  // (and online, which is fulfilled the same way) has its own prep/pack
  // rhythm and a rider waiting on it — splitting the board keeps the two
  // workflows from competing for the same visual queue.
  const dineInTakeaway = filtered.filter((o) => o.order_type === "DINE_IN" || o.order_type === "TAKEAWAY");
  const delivery = filtered.filter((o) => o.order_type === "DELIVERY" || o.order_type === "ONLINE");

  const isToday = businessDate === todayIso();

  return (
    <div>
      <PageHeader
        title="Kitchen"
        description="Orders waiting to be prepared. Tap Mark Ready once an order is done."
        actions={
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={() => setShowReady((v) => !v)}
              className="text-xs font-semibold text-slate-500 underline underline-offset-2"
            >
              {showReady ? "Show pending only" : "Show ready too"}
            </button>
            {showReady && (
              <div className="flex items-center gap-1.5">
                <Calendar size={14} className="text-slate-400" />
                <input
                  type="date"
                  value={businessDate}
                  onChange={(e) => setBusinessDate(e.target.value || todayIso())}
                  className="bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm text-slate-900"
                />
                <span className="text-xs text-slate-500 font-medium tabular-nums">{toDdMmYyyy(businessDate)}</span>
                {!isToday && (
                  <button onClick={() => setBusinessDate(todayIso())} className="text-xs font-semibold text-brand-600 underline underline-offset-2">
                    Today
                  </button>
                )}
              </div>
            )}
          </div>
        }
      />
      {isLoading && <div className="text-center text-slate-400 py-16">Loading…</div>}
      {!isLoading && filtered.length === 0 && (
        <div className="text-center text-slate-400 py-24">
          <ChefHat size={48} className="mx-auto mb-3 opacity-40" />
          <div className="text-lg font-medium">{showReady ? "No orders that day." : "All caught up — no orders waiting."}</div>
        </div>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-col xl:flex-row gap-6 mt-2">
          <KitchenSection
            title="Dine-in & Takeaway"
            icon={<UtensilsCrossed size={18} />}
            accent="bg-blue-600"
            orders={dineInTakeaway}
            emptyLabel={showReady ? "No dine-in/takeaway orders that day." : "No dine-in/takeaway orders waiting."}
          />
          <div className="hidden xl:block w-px bg-slate-200" />
          <KitchenSection
            title="Delivery"
            icon={<Bike size={18} />}
            accent="bg-orange-600"
            orders={delivery}
            emptyLabel={showReady ? "No delivery orders that day." : "No delivery orders waiting."}
          />
        </div>
      )}
    </div>
  );
}
