import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChefHat, Clock, CheckCircle2, Calendar, UtensilsCrossed, Bike, MapPin, Phone, AlertTriangle, Undo2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { PaymentModeBanner, customerNoteOf } from "../components/PaymentModeBanner";
import { ORDER_TYPE_STYLE, OrderTypeBadge, PageHeader } from "../components/ui/Primitives";
import { toDdMmYyyy } from "../utils/date";
import { playChime } from "../components/WebOrderNotifier";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
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
  const ready = order.kitchen_status === "READY";
  const late = !ready && age >= 15;
  const warn = !ready && age >= 10 && !late;
  const items = (order.items ?? []).filter((i) => i.status === "ACTIVE");
  const isDelivery = order.order_type === "DELIVERY" || order.order_type === "ONLINE";

  // The chef taps Ready once the food is cooked AND packed. Delivery orders
  // go straight to the least-busy rider in the same step; dine-in / takeaway
  // just leave the board. The button locks while saving (no double taps) and
  // stays locked once the ticket is ready.
  const markReadyMutation = useMutation({
    mutationFn: () => api.post<{ dispatchWarning: string | null }>(`/orders/${order.id}/kitchen-ready`),
    onSuccess: (res) => {
      if (res.dispatchWarning) toast.error(`#${order.order_number} ready, but no rider sent: ${res.dispatchWarning}`, { duration: 8000 });
      else toast.success(isDelivery ? `#${order.order_number} ready — sent to rider` : `#${order.order_number} ready`);
      queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update order"),
  });

  const orderNote = customerNoteOf(order.notes);

  return (
    <div
      className={`rounded-2xl border-2 border-l-8 bg-white shadow-sm overflow-hidden flex flex-col ${ORDER_TYPE_STYLE[order.order_type]?.stripe ?? ""} ${
        ready ? "border-emerald-200 opacity-70" : late ? "border-rose-400" : warn ? "border-amber-300" : "border-slate-200"
      }`}
    >
      <div className={`flex items-center justify-between gap-2 px-3.5 py-2.5 ${ready ? "bg-emerald-50" : late ? "bg-rose-50" : warn ? "bg-amber-50" : "bg-slate-50"}`}>
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-2xl font-extrabold text-slate-900 leading-none">#{order.order_number}</span>
          <OrderTypeBadge type={order.order_type} />
        </span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-bold whitespace-nowrap tabular-nums ${
            ready ? "bg-emerald-600 text-white" : late ? "bg-rose-600 text-white animate-pulse" : warn ? "bg-amber-500 text-white" : "bg-emerald-100 text-emerald-700"
          }`}
        >
          <Clock size={14} /> {age === 0 ? "now" : `${age} min`}
        </span>
      </div>

      <div className="px-3.5 py-2 border-b border-slate-100 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <PaymentModeBanner order={order} />
          {order.customer_name?.trim() && <span className="text-sm font-bold text-slate-900 truncate">{order.customer_name}</span>}
        </div>
        {order.customer_phone && (
          <div className="flex items-center gap-1.5 text-sm text-slate-700">
            <Phone size={13} className="text-slate-500 shrink-0" /> {order.customer_phone}
          </div>
        )}
        {isDelivery && order.delivery_address?.trim() && (
          <div className="flex items-start gap-1.5 text-sm text-slate-800 font-medium leading-snug">
            <MapPin size={14} className="text-orange-500 shrink-0 mt-0.5" /> {order.delivery_address}
          </div>
        )}
      </div>

      <div className="flex-1 px-3.5 py-2.5 divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2 py-1.5 first:pt-0 last:pb-0">
            <div className="min-w-0 leading-snug">
              <span className="text-base font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-sm text-slate-500"> ({item.price_type})</span>}
              {(item.addons ?? []).length > 0 && (
                <div className="text-sm text-slate-600">+ {item.addons.map((a) => a.name).join(", ")}</div>
              )}
              {item.special_instructions && <div className="text-sm text-amber-700 font-semibold">⚠ {item.special_instructions}</div>}
            </div>
            <span className="shrink-0 rounded-lg bg-brand-50 px-2.5 py-0.5 text-xl font-extrabold tabular-nums leading-tight text-brand-700">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {orderNote && (
        <div className="mx-3.5 mb-2.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-sm font-semibold text-amber-800">
          ⚠ {orderNote}
        </div>
      )}

      {ready ? (
        <div className="w-full flex items-center justify-center gap-1.5 bg-emerald-100 text-emerald-700 font-bold text-base py-3">
          <CheckCircle2 size={18} /> Ready
        </div>
      ) : (
        <button
          disabled={markReadyMutation.isPending || markReadyMutation.isSuccess}
          onClick={() => markReadyMutation.mutate()}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-bold text-lg py-4 disabled:opacity-50 [touch-action:manipulation] active:bg-emerald-700"
        >
          {isDelivery ? <Bike size={20} /> : <CheckCircle2 size={20} />}
          {markReadyMutation.isPending || markReadyMutation.isSuccess ? "Saving…" : isDelivery ? "Ready — Send to rider" : "Ready"}
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
          <div className="flex items-center gap-2 bg-slate-800 text-white text-xs font-bold px-3 py-1.5 rounded-lg mt-3 first:mt-3">
            <Calendar size={14} />
            {toDdMmYyyy(date)}
            <span className="font-normal text-slate-300">
              · {dateOrders.length} order{dateOrders.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(265px,1fr))] gap-3.5 mt-3">
            {dateOrders.map((o) => (
              <OrderTicket key={o.id} order={o} />
            ))}
          </div>
        </Fragment>
      ))}
    </section>
  );
}

/** Orders marked ready in the last 10 minutes, with a one-tap undo for mis-taps. */
function RecentlyReady({ orders }: { orders: SalesOrder[] }) {
  const queryClient = useQueryClient();
  const undo = useMutation({
    mutationFn: (id: string) => api.post(`/orders/${id}/kitchen-undo`),
    onSuccess: () => {
      toast.success("Order moved back to the kitchen");
      queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not undo"),
  });
  if (orders.length === 0) return null;
  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Recently ready</div>
      <div className="flex flex-wrap gap-2">
        {orders.map((o) => (
          <span key={o.id} className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span className="font-bold text-slate-900">#{o.order_number}</span>
            <OrderTypeBadge type={o.order_type} />
            <button
              disabled={undo.isPending}
              onClick={() => undo.mutate(o.id)}
              className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-rose-600 disabled:opacity-50"
            >
              <Undo2 size={13} /> Undo
            </button>
          </span>
        ))}
      </div>
    </div>
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

  // Chime when a new ticket lands (not on the first load).
  const pendingIds = (data?.orders ?? [])
    .filter((o) => o.kitchen_status === "PENDING" && !["CANCELLED", "REFUNDED", "PENDING_ACCEPTANCE", "DRAFT"].includes(o.status))
    .map((o) => o.id);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(pendingIds);
    if (seen.current && [...ids].some((id) => !seen.current!.has(id))) playChime();
    seen.current = ids;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const lateCount = filtered.filter((o) => o.kitchen_status === "PENDING" && minutesAgo(o.created_at) >= 15).length;
  const recentlyReady = (data?.orders ?? [])
    .filter((o) => o.kitchen_status === "READY" && o.packed_at && minutesAgo(o.packed_at) < 10 && !["CANCELLED", "REFUNDED"].includes(o.status))
    .filter((o) => !(o.order_type === "DELIVERY" && ["DELIVERED", "COMPLETED"].includes(o.status)))
    .sort((a, b) => new Date(b.packed_at!).getTime() - new Date(a.packed_at!).getTime());

  return (
    <div>
      <PageHeader
        title="Kitchen"
        description="Cook, pack, then tap Ready. Delivery orders go straight to a rider; dine-in and takeaway leave the board."
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
      {lateCount > 0 && !showReady && (
        <div className="mb-3 flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white">
          <AlertTriangle size={16} /> {lateCount} order{lateCount > 1 ? "s" : ""} waiting over 15 minutes
        </div>
      )}
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
            title="Delivery"
            icon={<Bike size={18} />}
            accent="bg-orange-600"
            orders={delivery}
            emptyLabel={showReady ? "No delivery orders that day." : "No delivery orders waiting."}
          />
          <div className="hidden xl:block w-px bg-slate-200" />
          <KitchenSection
            title="Dine-in & Takeaway"
            icon={<UtensilsCrossed size={18} />}
            accent="bg-blue-600"
            orders={dineInTakeaway}
            emptyLabel={showReady ? "No dine-in/takeaway orders that day." : "No dine-in/takeaway orders waiting."}
          />
        </div>
      )}
      {!showReady && <RecentlyReady orders={recentlyReady} />}
    </div>
  );
}
