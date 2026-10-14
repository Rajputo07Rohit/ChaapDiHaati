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
  const dispatch = useMutation({
    mutationFn: () => api.post<{ riderName: string | null }>(`/orders/${order.id}/assign-rider`, {}),
    onSuccess: (res) => {
      toast.success(`Order #${order.order_number} sent to ${res.riderName ?? "a rider"}`);
      queryClient.invalidateQueries({ queryKey: ["packing-orders"] });
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
      <div className={`flex items-center justify-between px-4 py-3 ${cooked ? "bg-emerald-50" : "bg-slate-50"}`}>
        <span className="flex items-center gap-2 text-xl font-extrabold text-slate-900">#{order.order_number} <OrderTypeBadge type={order.order_type} /> <PaymentModeBanner order={order} /></span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase ${
            cooked ? "bg-emerald-600 text-white" : "bg-amber-100 text-amber-700"
          }`}
        >
          {cooked ? (
            <>
              <Package size={12} /> Ready to pack
            </>
          ) : (
            <>
              <ChefHat size={12} /> In kitchen
            </>
          )}
        </span>
      </div>

      <div className="px-4 py-2 border-b border-slate-100 space-y-1.5">
        <div className="flex items-center justify-between text-sm">
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Clock size={13} /> {age === 0 ? "just now" : `${age} min ago`}
          </span>
          <span className="font-bold tabular-nums">{formatPaise(order.net_total_paise)}</span>
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

      <div className="flex-1 px-4 py-3 space-y-1.5">
        <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Pack checklist</div>
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2">
            <div>
              <span className="font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-sm text-slate-500"> ({item.price_type})</span>}
              {(item.addons ?? []).length > 0 && <div className="text-sm text-slate-600">+ {item.addons.map((a) => a.name).join(", ")}</div>}
              {item.special_instructions && <div className="text-sm text-amber-700 font-medium">Note: {item.special_instructions}</div>}
            </div>
            <span className="text-lg font-extrabold text-brand-600 tabular-nums shrink-0">×{item.quantity}</span>
          </div>
        ))}
        {customerNoteOf(order.notes) && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
            Special instructions: {customerNoteOf(order.notes)}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-slate-100 space-y-2">
        {!cooked ? (
          <div className="text-center text-sm font-medium text-slate-500 py-1.5">Waiting for the kitchen to mark this ready.</div>
        ) : (
          <Button className="w-full" disabled={dispatch.isPending} onClick={() => dispatch.mutate()}>
            <Truck size={16} /> {dispatch.isPending ? "Sending…" : "Packed — Send to rider"}
          </Button>
        )}
      </div>
    </div>
  );
}

export function Packing() {
  useClockTick();
  const { data, isLoading } = useQuery({
    queryKey: ["packing-orders"],
    queryFn: () => api.get<{ orders: SalesOrder[] }>("/orders?limit=300"),
    refetchInterval: 10_000,
  });

  // Delivery orders that staff accepted but that haven't left the shop yet.
  const waiting = (data?.orders ?? [])
    .filter((o) => o.order_type === "DELIVERY" && ["CONFIRMED", "PREPARING", "READY"].includes(o.status))
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const readyToPack = waiting.filter((o) => o.kitchen_status === "READY");
  const inKitchen = waiting.filter((o) => o.kitchen_status !== "READY");

  return (
    <div>
      <PageHeader
        title="Packing"
        description="Delivery orders cooked by the kitchen. Pack them and tap once — the order goes straight to the least-busy rider."
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
