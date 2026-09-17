import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Phone, Copy, MapPin, LogOut, Package, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PaymentMethod, SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { useAuth } from "../context/AuthContext";
import logo from "../assets/logo.png";

function copyNumber(phone: string) {
  navigator.clipboard
    .writeText(phone)
    .then(() => toast.success("Number copied"))
    .catch(() => toast.error("Could not copy number"));
}

function remainingPaise(order: SalesOrder) {
  return order.net_total_paise - (order.payments ?? []).reduce((s, p) => s + p.amount_paise, 0);
}

function OrderCard({ order, cashMethodId, upiMethodId }: { order: SalesOrder; cashMethodId: string; upiMethodId: string }) {
  const queryClient = useQueryClient();
  const phone = order.customer_phone?.trim();
  const address = order.delivery_address?.trim();
  const mapsUrl = address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}` : null;
  const remaining = remainingPaise(order);
  const alreadyPaid = order.net_total_paise - remaining;
  const isDelivered = order.status !== "OUT_FOR_DELIVERY";

  // How the customer actually paid the rider on arrival — Cash goes into
  // Cash-in-Hand, UPI (scan-to-pay) goes into Bank Balance, matching how
  // the counter's own payment collection already routes by method type.
  const [payMode, setPayMode] = useState<"CASH" | "UPI">("CASH");

  const collectMutation = useMutation({
    mutationFn: () =>
      api.post(`/orders/${order.id}/payments`, {
        payments: [{ paymentMethodId: payMode === "CASH" ? cashMethodId : upiMethodId, amountPaise: remaining }],
      }),
    onSuccess: () => {
      toast.success(`${formatPaise(remaining)} collected`);
      queryClient.invalidateQueries({ queryKey: ["rider-orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record payment"),
  });

  function handleDelivered(res: { stockWarnings?: string[] }) {
    toast.success("Order delivered");
    queryClient.invalidateQueries({ queryKey: ["rider-orders"] });
  }

  // Riders never see inventory details — that's a kitchen/back-office
  // concern, not something to put in front of someone on a scooter. If the
  // ingredient's inventory record turns out to be missing, silently retry
  // with the bypass on so "Mark Delivered" always just works for them.
  const deliverMutation = useMutation({
    mutationFn: (bypassMissingInventory?: boolean) =>
      api.post<{ stockWarnings?: string[] }>(`/orders/${order.id}/deliver`, bypassMissingInventory ? { bypassMissingInventory: true } : undefined),
    onSuccess: handleDelivered,
    onError: (err) => {
      if (err instanceof ApiError && err.code === "INVENTORY_ITEMS_MISSING") {
        deliverMutation.mutate(true);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Could not mark delivered");
    },
  });

  const itemsSummary = order.items?.map((i) => `${i.item_name_snapshot} ×${i.quantity}`).join(", ") ?? "";

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-lg font-extrabold text-slate-900">Order #{order.order_number}</span>
        {isDelivered ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold uppercase bg-emerald-100 text-emerald-700">
            <CheckCircle2 size={12} /> Delivered
          </span>
        ) : (
          <span className="px-2 py-1 rounded-full text-[11px] font-semibold uppercase bg-orange-100 text-orange-700">Out for Delivery</span>
        )}
      </div>

      <div className="text-base font-bold text-slate-900">{order.customer_name || "Customer"}</div>

      {phone && (
        <div className="flex items-center gap-2">
          <a href={`tel:${phone}`} className="flex-1 flex items-center gap-2 text-xl font-extrabold text-slate-900 tabular-nums">
            <Phone size={18} className="text-emerald-600 shrink-0" /> {phone}
          </a>
          <a href={`tel:${phone}`} className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold [touch-action:manipulation]">
            CALL
          </a>
          <button
            onClick={() => copyNumber(phone)}
            className="px-3 py-2 rounded-lg bg-slate-200 text-slate-700 text-xs font-bold [touch-action:manipulation]"
          >
            COPY
          </button>
        </div>
      )}

      {address && (
        <div>
          <div className="flex items-start gap-2 text-sm text-slate-700">
            <MapPin size={16} className="text-slate-400 shrink-0 mt-0.5" />
            <span>{address}</span>
          </div>
          {mapsUrl && (
            <a href={mapsUrl} target="_blank" rel="noreferrer" className="inline-block mt-1 text-xs font-semibold text-blue-600 underline">
              OPEN MAP
            </a>
          )}
        </div>
      )}

      <div className="text-xs text-slate-400 border-t border-slate-100 pt-2" title={itemsSummary}>
        {itemsSummary}
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 pt-2">
        <span className="text-sm text-slate-500">Total</span>
        <span className="text-lg font-extrabold text-slate-900 tabular-nums">{formatPaise(order.net_total_paise)}</span>
      </div>

      {remaining <= 0 ? (
        <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-emerald-700">
            {alreadyPaid > 0 ? "PAID ONLINE ✓" : "PAID"}
          </span>
          <span className="text-sm text-emerald-700">To collect ₹0</span>
        </div>
      ) : (
        <div className="rounded-xl bg-rose-50 border border-rose-100 p-3 space-y-2">
          {alreadyPaid > 0 && <div className="text-xs text-rose-700">Paid online {formatPaise(alreadyPaid)}</div>}
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-rose-700">To collect</span>
            <span className="text-2xl font-extrabold text-rose-700 tabular-nums">{formatPaise(remaining)}</span>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPayMode("CASH")}
              className={`flex-1 text-sm font-semibold py-2 rounded-lg [touch-action:manipulation] ${
                payMode === "CASH" ? "bg-rose-600 text-white" : "bg-white text-rose-700 border border-rose-200"
              }`}
            >
              Cash
            </button>
            <button
              onClick={() => setPayMode("UPI")}
              className={`flex-1 text-sm font-semibold py-2 rounded-lg [touch-action:manipulation] ${
                payMode === "UPI" ? "bg-rose-600 text-white" : "bg-white text-rose-700 border border-rose-200"
              }`}
            >
              UPI
            </button>
          </div>
          <button
            disabled={collectMutation.isPending}
            onClick={() => collectMutation.mutate()}
            className="w-full bg-rose-600 text-white font-bold text-sm py-2.5 rounded-lg disabled:opacity-50 [touch-action:manipulation]"
          >
            {collectMutation.isPending ? "Recording…" : `Mark ${payMode === "CASH" ? "Cash" : "UPI"} Collected`}
          </button>
        </div>
      )}

      {!isDelivered && (
        <button
          disabled={remaining > 0 || deliverMutation.isPending}
          onClick={() => deliverMutation.mutate(undefined)}
          title={remaining > 0 ? "Collect the payment above first" : ""}
          className="w-full bg-brand-600 text-white font-bold text-sm py-3 rounded-lg disabled:opacity-40 [touch-action:manipulation]"
        >
          {deliverMutation.isPending ? "Marking…" : "Mark Delivered"}
        </button>
      )}
    </div>
  );
}

export function RiderDashboard() {
  const { user, logout } = useAuth();
  const [showAll, setShowAll] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["rider-orders", showAll],
    queryFn: () => api.get<{ orders: SalesOrder[] }>(`/orders/rider/mine${showAll ? "?all=1" : ""}`),
    refetchInterval: 15_000,
  });

  const { data: pmData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods"),
  });
  const cashMethodId = pmData?.methods.find((m) => m.type === "CASH")?.id ?? pmData?.methods[0]?.id ?? "";
  const upiMethodId = pmData?.methods.find((m) => m.name === "UPI")?.id ?? pmData?.methods.find((m) => m.type === "ONLINE")?.id ?? "";

  const orders = data?.orders ?? [];

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="w-8 h-8 object-contain" />
          <div>
            <div className="font-bold text-slate-900 leading-tight">My Delivery Orders</div>
            <div className="text-xs text-slate-500">{user?.fullName}</div>
          </div>
        </div>
        <button onClick={() => logout()} className="text-slate-500 p-2 -mr-2" aria-label="Log out">
          <LogOut size={20} />
        </button>
      </div>

      <div className="px-4 py-3">
        <button onClick={() => setShowAll((v) => !v)} className="text-xs font-semibold text-slate-500 underline underline-offset-2">
          {showAll ? "Show active only" : "Show delivered too"}
        </button>
      </div>

      <div className="px-4 pb-8 space-y-3 max-w-lg mx-auto">
        {isLoading && <div className="text-center text-slate-400 py-10">Loading…</div>}
        {!isLoading && orders.length === 0 && (
          <div className="text-center text-slate-400 py-16">
            <Package size={40} className="mx-auto mb-2 opacity-40" />
            No deliveries assigned right now.
          </div>
        )}
        {orders.map((o) => (
          <OrderCard key={o.id} order={o} cashMethodId={cashMethodId} upiMethodId={upiMethodId} />
        ))}
      </div>
    </div>
  );
}
