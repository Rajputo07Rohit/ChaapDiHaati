import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Bell, Truck } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { Button, Input, Modal, Select } from "./ui/Primitives";
import { useAuth } from "../context/AuthContext";

function OrderPreview({
  order,
  riders,
  onDone,
}: {
  order: SalesOrder;
  riders: { id: string; fullName: string }[];
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
    mutationFn: () => api.post(`/orders/${order.id}/accept`, undefined),
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
        <span className="text-xs font-semibold text-slate-500 uppercase">{order.order_type.replace("_", "-")}</span>
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

  if (!user || user.role === "RIDER" || orders.length === 0 || dismissed) return null;

  return (
    <Modal open title={`New Online Order${orders.length > 1 ? `s (${orders.length})` : ""}`} onClose={() => setDismissed(true)}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-brand-700 bg-brand-50 rounded-lg px-3 py-2">
          <Bell size={16} />A customer placed an order — accept to send it to the kitchen, or deny it.
        </div>
        {orders.map((o) => (
          <OrderPreview key={o.id} order={o} riders={riders} onDone={() => {}} />
        ))}
      </div>
    </Modal>
  );
}
