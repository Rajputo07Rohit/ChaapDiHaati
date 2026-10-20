import { Fragment, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChefHat, Clock, CheckCircle2, Calendar, MapPin, UtensilsCrossed, Bike, User, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { PaymentModeBanner, customerNoteOf } from "../components/PaymentModeBanner";
import { ORDER_TYPE_STYLE, PackingBadge, PageHeader } from "../components/ui/Primitives";
import { toDdMmYyyy } from "../utils/date";
import { SoldOutButton } from "../components/SoldOutPanel";

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
    mutationFn: () => api.post<{ dispatchWarning?: string | null }>(`/orders/${order.id}/kitchen-ready`),
    onSuccess: (res) => {
      // Delivery orders are handed to the least-busy rider by the server in this same step.
      if (res?.dispatchWarning) toast.error(`Order #${order.order_number} ready, but no rider was sent: ${res.dispatchWarning}`, { duration: 8000 });
      else toast.success(order.order_type === "DELIVERY" ? `Order #${order.order_number} ready — sent to rider` : `Order #${order.order_number} ready`);
      queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update order"),
  });

  const removeMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/kitchen-remove`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["kitchen-orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not remove order"),
  });

  return (
    <div
      className={`rounded-xl border-2 bg-white overflow-hidden flex flex-col ${
        ready ? "border-emerald-300" : urgent ? "border-rose-400" : "border-slate-200"
      }`}
    >
      <div className={`flex items-center justify-between gap-2 px-4 py-3 ${ready ? "bg-emerald-50" : urgent ? "bg-rose-50" : "bg-slate-50"}`}>
        <span className="text-2xl font-black leading-none tracking-tight text-slate-900">#{order.order_number}</span>
        <span className="flex flex-wrap items-center justify-end gap-1.5">
          <PackingBadge order={order} size="lg" />
          <span
            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${
              ORDER_TYPE_STYLE[order.order_type]?.badge ?? "bg-slate-200 text-slate-700"
            }`}
          >
            {ORDER_TYPE_STYLE[order.order_type]?.label ?? order.order_type}
          </span>
        </span>
      </div>

      <div className="px-4 py-2.5 border-b border-slate-100 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
              ready ? "bg-emerald-600 text-white" : urgent ? "bg-rose-600 text-white animate-pulse" : "bg-slate-200 text-slate-700"
            }`}
          >
            <Clock size={12} /> {age === 0 ? "Just now" : `${age} min`}
          </span>
          <span className="whitespace-nowrap text-xs font-medium text-slate-400 tabular-nums">{formatTime(order.created_at)}</span>
        </div>
        {(order.customer_name?.trim() || order.order_type === "DELIVERY" || order.order_type === "ONLINE") && (
          <div className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-slate-900">
              <User size={14} className="shrink-0 text-slate-400" />
              <span className="truncate">{order.customer_name?.trim() || "Walk-in"}</span>
            </span>
            {(order.order_type === "DELIVERY" || order.order_type === "ONLINE") && (
              <span className="shrink-0">
                <PaymentModeBanner order={order} />
              </span>
            )}
          </div>
        )}
        {order.order_type === "DELIVERY" && order.delivery_address?.trim() && (
          <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs leading-snug text-slate-700">
            <MapPin size={15} className="mt-0.5 shrink-0 text-orange-500" />
            <span className="font-medium">{order.delivery_address}</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-1 divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2 py-2">
            <div className="min-w-0">
              <span className="text-base font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-xs text-slate-500"> ({item.price_type})</span>}
              {(item.addons ?? []).length > 0 && (
                <div className="text-xs text-slate-600">+ {item.addons.map((a) => a.name).join(", ")}</div>
              )}
              {item.special_instructions && <div className="text-xs text-amber-700 font-medium">Note: {item.special_instructions}</div>}
            </div>
            <span className="text-xl font-extrabold text-brand-600 tabular-nums shrink-0">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {customerNoteOf(order.notes) && (
        <div className="mx-4 mb-2.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
          Special instructions: {customerNoteOf(order.notes)}
        </div>
      )}

      <div className="grid grid-cols-[1fr_auto] gap-2 p-2.5 pt-0">
        <button
          disabled={ready || markReadyMutation.isPending || markReadyMutation.isSuccess}
          onClick={() => markReadyMutation.mutate()}
          className={`flex items-center justify-center gap-1.5 rounded-lg font-bold text-base py-3 [touch-action:manipulation] ${
            ready || markReadyMutation.isSuccess
              ? "bg-emerald-100 text-emerald-700"
              : "bg-emerald-600 text-white disabled:opacity-50 active:bg-emerald-700"
          }`}
        >
          {ready || markReadyMutation.isSuccess ? (
            <>
              <CheckCircle2 size={16} /> Ready
            </>
          ) : markReadyMutation.isPending ? (
            "Marking Ready…"
          ) : (
            "Mark Ready"
          )}
        </button>
        {/* Only usable once the order is marked ready; clears the ticket off the board. */}
        <button
          disabled={!ready || removeMutation.isPending}
          onClick={() => removeMutation.mutate()}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 font-bold text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent [touch-action:manipulation]"
        >
          <Trash2 size={14} /> Remove
        </button>
      </div>
    </div>
  );
}

/** Groups orders by business date (oldest date first, orders within
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
  return groups.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
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

      {/* Each lane scrolls on its own; the scrollbar is hidden. */}
      <div className="no-scrollbar mt-3 max-h-[calc(100vh-15rem)] overflow-y-auto">
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
          <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4 mt-3">
            {dateOrders.map((o) => (
              <OrderTicket key={o.id} order={o} />
            ))}
          </div>
        </Fragment>
      ))}
      </div>
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
      api.get<{ orders: SalesOrder[] }>(showReady ? `/orders?businessDate=${businessDate}&limit=300` : `/orders/kitchen`),
    // The default feed is tiny (only open tickets), so poll fast — and keep polling in a background tab.
    refetchInterval: showReady ? 15_000 : 4_000,
    refetchIntervalInBackground: true,
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
    // Ready tickets stay on the board (with Remove enabled) until staff clear them.
    .filter(
      (o) =>
        showReady ||
        o.kitchen_status === "PENDING" ||
        (!o.kitchen_removed_at && !!o.kitchen_ready_at && minutesAgo(o.kitchen_ready_at) < 360)
    );

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
            <SoldOutButton />
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
        <div className="flex flex-col xl:flex-row gap-4 mt-2">
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
