import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Bell, Truck } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { Button, Input, Modal, Select } from "./ui/Primitives";
import { useAuth } from "../context/AuthContext";

const PREP_OPTIONS = [15, 25, 40, 60];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, []);
  return now;
}

function waitingLabel(createdAt: string, now: number) {
  const secs = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

/** One soft chime for the whole queue (not one per order). */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio blocked until the user interacts with the page — ignore */
  }
}

function OrderPreview({
  order,
  riders,
  prepMinutes,
  now,
  onDone,
}: {
  order: SalesOrder;
  riders: { id: string; fullName: string }[];
  prepMinutes: number;
  now: number;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("Denied by restaurant");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["pending-customer-orders"] });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };

  const acceptMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/accept`, { prepTimeMinutes: prepMinutes }),
    onSuccess: () => {
      toast.success(`Order #${order.order_number} accepted`);
      invalidate();
      onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not accept order"),
  });

  // For delivery orders, picking a rider here does everything in one step:
  // accepts the order (if still pending) and dispatches it, so it shows up
  // on that rider's phone immediately — no separate Accept click needed.
  const assignRiderMutation = useMutation({
    mutationFn: (riderId: string) => api.post(`/orders/${order.id}/assign-rider`, { riderId }),
    onSuccess: () => {
      toast.success(`Order #${order.order_number} sent out for delivery`);
      invalidate();
      onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not assign rider"),
  });

  const denyMutation = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/cancel`, { reason }),
    onSuccess: () => {
      toast.success(`Order #${order.order_number} denied`);
      invalidate();
      onDone();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not deny order"),
  });

  const itemsSummary = order.items?.map((i) => `${i.item_name_snapshot} ×${i.quantity}`).join(", ") ?? "";
  const busy = acceptMutation.isPending || denyMutation.isPending || assignRiderMutation.isPending;
  const isDelivery = order.order_type === "DELIVERY";

  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="font-bold text-slate-900">Order #{order.order_number}</span>
        <span className="text-xs font-semibold text-slate-500 uppercase">
          {order.order_type.replace("_", "-")} · waiting {waitingLabel(order.created_at, now)}
        </span>
      </div>
      {(order.customer_name || order.customer_phone) && (
        <div className="text-sm text-slate-600">
          {order.customer_name} {order.customer_phone && `· ${order.customer_phone}`}
        </div>
      )}
      {order.delivery_address && <div className="text-xs text-slate-500">{order.delivery_address}</div>}
      <div className="text-sm text-slate-700">{itemsSummary}</div>
      <div className="flex items-center justify-between text-sm font-semibold">
        <span>Total</span>
        <span className="tabular-nums">{formatPaise(order.net_total_paise)}</span>
      </div>

      {!denying ? (
        <div className="space-y-2 pt-1">
          {isDelivery && (
            <div className="flex items-center gap-1.5">
              <Truck size={14} className="shrink-0 text-blue-600" />
              <Select
                defaultValue=""
                disabled={busy}
                onChange={(e) => e.target.value && assignRiderMutation.mutate(e.target.value)}
                className="flex-1"
              >
                <option value="">{riders.length ? "Assign a rider — sends it out directly…" : "No riders set up yet"}</option>
                {riders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={busy} onClick={() => acceptMutation.mutate()}>
              {acceptMutation.isPending ? "Accepting…" : isDelivery ? "Accept (assign rider later)" : "Accept"}
            </Button>
            <Button size="sm" variant="danger" className="flex-1" disabled={busy} onClick={() => setDenying(true)}>
              Deny
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2 pt-1">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder="Reason" />
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" onClick={() => setDenying(false)} disabled={busy}>
              Back
            </Button>
            <Button size="sm" variant="danger" className="flex-1" disabled={!reason.trim() || busy} onClick={() => denyMutation.mutate()}>
              {denyMutation.isPending ? "Denying…" : "Confirm Deny"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Auto-popup shown to staff/admin on any screen whenever a customer
 * self-order is waiting to be accepted or denied (status
 * PENDING_ACCEPTANCE). Polls alongside the rest of the app; re-opens
 * whenever a new pending order id shows up, even if it was dismissed for
 * the previous batch.
 */
export function PendingOrdersPopup() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const now = useNow();
  const [prepMinutes, setPrepMinutes] = useState(25);

  const { data } = useQuery({
    queryKey: ["pending-customer-orders"],
    queryFn: () => api.get<{ orders: SalesOrder[] }>("/orders?status=PENDING_ACCEPTANCE&limit=20"),
    refetchInterval: 10_000,
    enabled: !!user && user.role !== "RIDER",
  });

  const { data: riderData } = useQuery({
    queryKey: ["rider-options"],
    queryFn: () => api.get<{ riders: { id: string; fullName: string }[] }>("/orders/rider/options"),
    enabled: !!user && user.role !== "RIDER",
  });

  const orders = data?.orders ?? [];
  const riders = riderData?.riders ?? [];

  useEffect(() => {
    const currentIds = new Set(orders.map((o) => o.id));
    const hasNew = [...currentIds].some((id) => !seenIds.current.has(id));
    if (hasNew) setDismissed(false);
    seenIds.current = currentIds;
  }, [orders]);

  // Repeat a single chime every 20s while anything is waiting.
  const hasPending = orders.length > 0 && !!user && user.role !== "RIDER";
  useEffect(() => {
    if (!hasPending) return;
    playChime();
    const t = setInterval(playChime, 20_000);
    return () => clearInterval(t);
  }, [hasPending]);

  const acceptAll = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        orders.map((o) => api.post(`/orders/${o.id}/accept`, { prepTimeMinutes: prepMinutes }))
      );
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (n) => {
      toast.success(`${n} order${n === 1 ? "" : "s"} accepted`);
      queryClient.invalidateQueries({ queryKey: ["pending-customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  if (!user || user.role === "RIDER" || orders.length === 0) return null;

  if (dismissed) {
    return (
      <button
        onClick={() => setDismissed(false)}
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-red-600 px-4 py-3 font-semibold text-white shadow-lg animate-pulse"
      >
        <Bell size={18} /> {orders.length} new order{orders.length > 1 ? "s" : ""} waiting
      </button>
    );
  }

  return (
    <Modal open title={`New Online Order${orders.length > 1 ? `s (${orders.length})` : ""}`} onClose={() => setDismissed(true)}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-brand-700 bg-brand-50 rounded-lg px-3 py-2">
          <Bell size={16} />Customers are waiting — accept to send to the kitchen, or deny. Oldest first.
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold text-slate-700">Ready in:</span>
          {PREP_OPTIONS.map((m) => (
            <button
              key={m}
              onClick={() => setPrepMinutes(m)}
              className={`rounded-full border px-3 py-1 ${prepMinutes === m ? "bg-brand-600 text-white border-brand-600" : "border-slate-300 text-slate-700"}`}
            >
              {m} min
            </button>
          ))}
        </div>
        {orders.length > 1 && (
          <Button className="w-full" disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
            {acceptAll.isPending ? "Accepting…" : `Accept all ${orders.length} (${prepMinutes} min)`}
          </Button>
        )}
        {[...orders].reverse().map((o) => (
          <OrderPreview key={o.id} order={o} riders={riders} prepMinutes={prepMinutes} now={now} onDone={() => {}} />
        ))}
      </div>
    </Modal>
  );
}
