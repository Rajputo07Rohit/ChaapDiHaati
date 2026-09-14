import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle } from "lucide-react";
import { api, ApiError } from "../api/client";
import { SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { printReceipt } from "../utils/receipt";
import { Badge, Button, Card, EmptyState, Input, Modal, OrderStatusBadge, PageHeader, Select } from "../components/ui/Primitives";
import { ShareBillModal } from "../components/ShareBillModal";
import { useAuth } from "../context/AuthContext";

export function Orders() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelTarget, setCancelTarget] = useState<SalesOrder | null>(null);
  const [sharing, setSharing] = useState<SalesOrder | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["orders", status],
    queryFn: () => api.get<{ orders: SalesOrder[] }>(`/orders${status ? `?status=${status}` : "?limit=100"}`),
    refetchInterval: 15_000,
  });

  const { data: detail } = useQuery({
    queryKey: ["order", selected?.id],
    queryFn: () => api.get<{ order: SalesOrder }>(`/orders/${selected!.id}`),
    enabled: !!selected,
  });

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/orders/${cancelTarget!.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success("Order cancelled");
      setCancelTarget(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not cancel order"),
  });

  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER";

  return (
    <div>
      <PageHeader
        title="Orders"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["DRAFT", "CONFIRMED", "PREPARING", "READY", "COMPLETED", "CANCELLED", "REFUNDED"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Order #</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.orders ?? []).map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(o)}>
                  <td className="px-4 py-2.5 font-medium">#{o.order_number}</td>
                  <td className="px-4 py-2.5 text-slate-500">{o.business_date}</td>
                  <td className="px-4 py-2.5 text-slate-500">{o.order_type.replace("_", "-")}</td>
                  <td className="px-4 py-2.5">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(o.net_total_paise)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && ["DRAFT", "CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelTarget(o);
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.orders.length ?? 0) === 0 && <EmptyState title="No orders found" description="Try a different filter." />}
        </div>
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order #${selected.order_number}` : ""}>
        {detail?.order && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <OrderStatusBadge status={detail.order.status} />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">{detail.order.business_date}</span>
                {(detail.order.status === "COMPLETED" || detail.order.status === "REFUNDED") && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => printReceipt(detail.order)}>
                      Print Bill
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setSharing(detail.order)}>
                      <MessageCircle size={14} /> Share on WhatsApp
                    </Button>
                  </>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {detail.order.items?.map((item) => (
                <div key={item.id} className="py-2 flex justify-between">
                  <div>
                    <div className="font-medium">
                      {item.item_name_snapshot} ({item.price_type.toLowerCase()}) × {item.quantity}
                    </div>
                    {item.discount_paise > 0 && (
                      <div className="text-xs text-rose-600">
                        -{formatPaise(item.discount_paise)} ({item.discount_type === "PERCENTAGE" ? `${item.discount_value}%` : "flat"} item discount)
                      </div>
                    )}
                    {item.cogs_paise != null && <div className="text-xs text-slate-400">COGS: {formatPaise(item.cogs_paise)}</div>}
                  </div>
                  <span className="tabular-nums">{formatPaise(item.line_net_paise)}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-slate-500">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatPaise(detail.order.subtotal_paise)}</span>
              </div>
              {detail.order.item_discount_total_paise > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Item discounts</span>
                  <span className="tabular-nums">-{formatPaise(detail.order.item_discount_total_paise)}</span>
                </div>
              )}
              {detail.order.discount_paise > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Order discount ({detail.order.discount_type === "PERCENTAGE" ? `${detail.order.discount_value}%` : "flat"})</span>
                  <span className="tabular-nums">-{formatPaise(detail.order.discount_paise)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>Net Total</span>
                <span>{formatPaise(detail.order.net_total_paise)}</span>
              </div>
              {detail.order.discount_reason && <div className="text-xs text-slate-400">Discount reason: {detail.order.discount_reason}</div>}
            </div>
            {detail.order.payments && detail.order.payments.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-1">Payments</div>
                {detail.order.payments.map((p) => (
                  <div key={p.id} className="flex justify-between text-slate-600">
                    <span>{p.payment_method_name}</span>
                    <span>{formatPaise(p.amount_paise)}</span>
                  </div>
                ))}
              </div>
            )}
            {detail.order.cancel_reason && (
              <div className="bg-rose-50 text-rose-700 rounded p-2 text-xs">Cancelled: {detail.order.cancel_reason}</div>
            )}
            {detail.order.notes && <div className="text-xs text-slate-400">Note: {detail.order.notes}</div>}
          </div>
        )}
      </Modal>

      <Modal open={!!cancelTarget} onClose={() => setCancelTarget(null)} title={`Cancel Order #${cancelTarget?.order_number}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">A reason is required. Cancelled orders are never counted as sales.</p>
          <Input placeholder="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full" />
          <Button variant="danger" className="w-full" disabled={!cancelReason || cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
            Confirm Cancellation
          </Button>
        </div>
      </Modal>

      <ShareBillModal order={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}
