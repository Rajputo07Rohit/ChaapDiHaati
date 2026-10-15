import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ChefHat, Clock, MapPin, Package, Phone, Truck, User } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { PaymentModeBanner, customerNoteOf } from "../components/PaymentModeBanner";
import { Button, OrderTypeBadge, PageHeader } from "../components/ui/Primitives";
import { formatPaise } from "../utils/money";

function minutesAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

function useClockTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
}

function PackingCard({ order }: { order: SalesOrder }) {
  const queryClient = useQueryClient();
  const cooked = order.kitchen_status === "READY";
  const items = (order.items ?? []).filter((i) => i.status === "ACTIVE");
  const age = minutesAgo(order.created_at);

  // Packed = out for delivery. The server picks the rider with the fewest
  // open deliveries and the order shows up on their phone immediately.
  const isDelivery = order.order_type === "DELIVERY";
  const dispatch = useMutation({
    mutationFn: () =>
      isDelivery
        ? api.post<{ riderName: string | null }>(`/orders/${order.id}/assign-rider`, {})
        : api.post<{ riderName: string | null }>(`/orders/${order.id}/packed`, {}),
    onSuccess: (res) => {
      toast.success(isDelivery ? `Order #${order.order_number} sent to ${res.riderName ?? "a rider"}` : `Order #${order.order_number} packed`);
            queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not send order out"),
  });

  return (
    <div
      className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden flex flex-col ${
        cooked ? "border-emerald-300" : "border-slate-200 opacity-80"
      }`}
    >
      <div className={`flex items-center justify-between gap-2 px-4 py-3 ${cooked ? "bg-emerald-50" : "bg-slate-50"}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-2xl font-extrabold leading-none text-slate-900">#{order.order_number}</span>
          <OrderTypeBadge type={order.order_type} />
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-1 rounded-full text-xs font-bold uppercase ${
            cooked ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-700"
          }`}
        >
          {cooked ? (
            <>
              <Package size={13} /> Ready
            </>
          ) : (
            <>
              <ChefHat size={13} /> In kitchen
            </>
          )}
        </span>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <PaymentModeBanner order={order} large />
          <div className="text-right leading-tight">
            <div className="text-lg font-extrabold tabular-nums text-slate-900">{formatPaise(order.net_total_paise)}</div>
            <div className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Clock size={11} /> {age === 0 ? "just now" : `${age} min ago`}
            </div>
          </div>
        </div>
        {order.customer_name?.trim() && (
          <div className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <User size={14} className="text-slate-500 shrink-0" />
            {order.customer_name}
          </div>
        )}
        {order.customer_phone && (
          <div className="flex items-center gap-1.5 text-sm text-slate-700">
            <Phone size={14} className="text-slate-500 shrink-0" />
            {order.customer_phone}
          </div>
        )}
        {order.delivery_address?.trim() && (
          <div className="flex items-start gap-1.5 text-sm text-slate-700">
            <MapPin size={14} className="text-orange-500 shrink-0 mt-0.5" />
            <span className="font-medium">{order.delivery_address}</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-3">
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-400">Pack checklist</div>
        <div className="divide-y divide-slate-100">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 py-2">
            <div>
              <span className="font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-sm text-slate-500"> ({item.price_type})</span>}
              {(item.addons ?? []).length > 0 && <div className="text-sm text-slate-600">+ {item.addons.map((a) => a.name).join(", ")}</div>}
              {item.special_instructions && <div className="text-sm text-amber-700 font-medium">Note: {item.special_instructions}</div>}
            </div>
            <span className="shrink-0 rounded-lg bg-brand-50 px-2.5 py-0.5 text-base font-extrabold tabular-nums text-brand-700">×{item.quantity}</span>
          </div>
        ))}
        </div>
        {customerNoteOf(order.notes) && (
          <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
            Special instructions: {customerNoteOf(order.notes)}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-100">
        {!cooked ? (
          <div className="text-center text-sm font-medium text-slate-500 py-1.5">Waiting for the kitchen to mark this ready.</div>
        ) : (
          <Button className="w-full py-3 text-base" disabled={dispatch.isPending} onClick={() => dispatch.mutate()}>
            {isDelivery ? <Truck size={16} /> : <Package size={16} />}{" "}
            {dispatch.isPending ? "Saving…" : isDelivery ? "Packed — Send to rider" : "Packed — Handed over"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Packing() {
  useClockTick();
  const { data, isLoading } = useQuery({
    queryKey: ["orders", "packing"],
    queryFn: () => api.get<{ orders: SalesOrder[] }>("/orders?limit=300"),
    // Poll fast, even in a background tab, so new orders appear without a manual refresh.
    refetchInterval: 4_000,
    refetchIntervalInBackground: true,
  });

  // Every accepted order (dine-in, takeaway, delivery) that hasn't been packed
  // yet. Limited to the last two business days so old history never floods the board.
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const waiting = (data?.orders ?? [])
    .filter((o) => !["DRAFT", "PENDING_ACCEPTANCE", "CANCELLED", "REFUNDED", "DELIVERED", "OUT_FOR_DELIVERY"].includes(o.status))
    // A delivery that already left the shop (even before packing was tracked) isn't waiting.
    .filter((o) => o.order_type !== "DELIVERY" || ["CONFIRMED", "PREPARING", "READY"].includes(o.status))
    .filter((o) => !o.packed_at && o.business_date >= since)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const readyToPack = waiting.filter((o) => o.kitchen_status === "READY");
  const inKitchen = waiting.filter((o) => o.kitchen_status !== "READY");

  return (
    <div>
      <PageHeader
        title="Packing"
        description="Orders cooked by the kitchen. Pack them and tap once — delivery orders go straight to the least-busy rider; dine-in and takeaway are marked handed over."
        actions={
          <span className="text-sm font-semibold text-slate-600">
            {readyToPack.length} ready to pack · {inKitchen.length} still in kitchen
          </span>
        }
      />
      {isLoading && <div className="text-center text-slate-400 py-16">Loading…</div>}
      {!isLoading && waiting.length === 0 && (
        <div className="text-center text-slate-400 py-24">
          <Package size={48} className="mx-auto mb-3 opacity-40" />
          <div className="text-lg font-medium">Nothing to pack right now.</div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {[...readyToPack, ...inKitchen].map((o) => (
          <PackingCard key={o.id} order={o} />
        ))}
      </div>
    </div>
  );
}
