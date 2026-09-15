import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, Phone, MapPin, User as UserIcon, Truck } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PaymentMethod, SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { printReceipt } from "../utils/receipt";
import { Button, Card, EmptyState, Input, Modal, OrderStatusBadge, PageHeader, PaymentStatusBadge, Select } from "../components/ui/Primitives";
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
  const [payTarget, setPayTarget] = useState<SalesOrder | null>(null);
  const [payMethodId, setPayMethodId] = useState("");
  const [recordPayOpen, setRecordPayOpen] = useState(false);
  const [recordPayAmount, setRecordPayAmount] = useState("");
  const [recordPayMethodId, setRecordPayMethodId] = useState("");
  const [refundTarget, setRefundTarget] = useState<SalesOrder | null>(null);
  const [refundType, setRefundType] = useState<"FULL" | "PARTIAL">("FULL");
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundMethodId, setRefundMethodId] = useState("");

  const { data: pmData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods"),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["orders", status],
    queryFn: () => api.get<{ orders: SalesOrder[] }>(`/orders${status ? `?status=${status}` : "?limit=100"}`),
    refetchInterval: 15_000,
  });

  const { data: detail } = useQuery({
    queryKey: ["order", selected?.id],
    queryFn: () => api.get<{ order: SalesOrder }>(`/orders/${selected!.id}`),
    enabled: !!selected,
    // A rider can complete/deliver this exact order from their own phone
    // while an admin/staff has it open here watching — poll so that shows
    // up without needing a manual reload.
    refetchInterval: 8_000,
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

  const collectPaymentMutation = useMutation({
    mutationFn: () =>
      api.post(`/orders/${payTarget!.id}/complete`, {
        payments: [{ paymentMethodId: payMethodId, amountPaise: payTarget!.net_total_paise }],
      }),
    onSuccess: () => {
      toast.success("Payment collected — order completed");
      setPayTarget(null);
      setPayMethodId("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not collect payment"),
  });

  const refundMutation = useMutation({
    mutationFn: () =>
      api.post(`/orders/${refundTarget!.id}/refund`, {
        amountPaise: Math.round(parseFloat(refundAmount) * 100),
        reason: refundReason,
        refundType,
        paymentMethodId: refundMethodId,
      }),
    onSuccess: () => {
      toast.success("Refund recorded");
      setRefundTarget(null);
      setRefundAmount("");
      setRefundReason("");
      setRefundMethodId("");
      setRefundType("FULL");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record refund"),
  });

  // Refund is Admin/Manager only (real money reversal) — Cancel and
  // rider-assignment are open to any signed-in staff-side role
  // (Admin/Manager/Staff) — Riders never reach this page at all.
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "STAFF";
  const canRefund = user?.role === "ADMIN" || user?.role === "MANAGER";

  const { data: riderOptions } = useQuery({
    queryKey: ["rider-options"],
    queryFn: () => api.get<{ riders: { id: string; fullName: string }[] }>("/orders/rider/options"),
    enabled: canManage,
  });

  const assignRiderMutation = useMutation({
    mutationFn: (riderId: string) => api.post(`/orders/${detail!.order.id}/assign-rider`, { riderId }),
    onSuccess: () => {
      toast.success("Rider assigned");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not assign rider"),
  });

  const advanceStatusMutation = useMutation({
    mutationFn: (nextStatus: string) => api.patch(`/orders/${detail!.order.id}/status`, { status: nextStatus }),
    onSuccess: () => {
      toast.success("Status updated");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update status"),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: () =>
      api.post(`/orders/${detail!.order.id}/payments`, {
        payments: [{ paymentMethodId: recordPayMethodId, amountPaise: Math.round(parseFloat(recordPayAmount || "0") * 100) }],
      }),
    onSuccess: () => {
      toast.success("Payment recorded");
      setRecordPayOpen(false);
      setRecordPayAmount("");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record payment"),
  });

  const NEXT_STATUS: Record<string, string> = { CONFIRMED: "PREPARING", PREPARING: "READY" };
  const remainingPaise = (o: SalesOrder) => o.net_total_paise - (o.payments ?? []).reduce((s, p) => s + p.amount_paise, 0);

  return (
    <div>
      <PageHeader
        title="Orders"
        actions={
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {["DRAFT", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "REFUNDED"].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
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
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Payment</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.orders ?? []).map((o) => (
                <tr key={o.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(o)}>
                  <td className="px-4 py-2.5 font-medium">#{o.order_number}</td>
                  <td className="px-4 py-2.5">
                    {o.customer_name || o.customer_phone ? (
                      <div>
                        {o.customer_name && <div className="font-medium text-slate-700">{o.customer_name}</div>}
                        {o.customer_phone && <div className="text-xs text-slate-400 tabular-nums">{o.customer_phone}</div>}
                      </div>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{o.business_date}</td>
                  <td className="px-4 py-2.5 text-slate-500">{o.order_type.replace("_", "-")}</td>
                  <td className="px-4 py-2.5">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-2.5">
                    <PaymentStatusBadge status={o.payment_status} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(o.net_total_paise)}</td>
                  <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                    {canManage && o.order_type !== "DELIVERY" && ["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPayTarget(o);
                          setPayMethodId(pmData?.methods[0]?.id ?? "");
                        }}
                      >
                        Collect Payment
                      </Button>
                    )}
                    {canManage && ["DRAFT", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"].includes(o.status) && (
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <OrderStatusBadge status={detail.order.status} />
                <PaymentStatusBadge status={detail.order.payment_status} />
              </div>
              <div className="flex items-center gap-2 flex-wrap">
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
                {canManage && NEXT_STATUS[detail.order.status] && (
                  <Button size="sm" variant="secondary" onClick={() => advanceStatusMutation.mutate(NEXT_STATUS[detail.order.status])}>
                    Mark {NEXT_STATUS[detail.order.status]}
                  </Button>
                )}
                {canManage && detail.order.order_type !== "DELIVERY" && ["CONFIRMED", "PREPARING", "READY"].includes(detail.order.status) && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setPayTarget(detail.order);
                      setPayMethodId(pmData?.methods[0]?.id ?? "");
                    }}
                  >
                    Collect Payment
                  </Button>
                )}
                {canManage &&
                  detail.order.order_type === "DELIVERY" &&
                  remainingPaise(detail.order) > 0 &&
                  !["COMPLETED", "CANCELLED", "REFUNDED"].includes(detail.order.status) && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setRecordPayAmount((remainingPaise(detail.order) / 100).toFixed(2));
                        setRecordPayMethodId(pmData?.methods[0]?.id ?? "");
                        setRecordPayOpen(true);
                      }}
                    >
                      Record Payment
                    </Button>
                  )}
                {canManage && detail.order.status === "OUT_FOR_DELIVERY" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={remainingPaise(detail.order) > 0}
                    title={remainingPaise(detail.order) > 0 ? "Collect the remaining balance first" : ""}
                    onClick={() => api.post(`/orders/${detail.order.id}/deliver`).then(() => {
                      toast.success("Order delivered & completed");
                      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
                      queryClient.invalidateQueries({ queryKey: ["orders"] });
                    }).catch((err) => toast.error(err instanceof ApiError ? err.message : "Could not mark delivered"))}
                  >
                    Mark Delivered
                  </Button>
                )}
                {canRefund && detail.order.status === "COMPLETED" && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setRefundTarget(detail.order);
                      setRefundType("FULL");
                      setRefundAmount((detail.order.net_total_paise / 100).toFixed(2));
                      setRefundMethodId(detail.order.payments?.[0]?.payment_method_id ?? pmData?.methods[0]?.id ?? "");
                    }}
                  >
                    Refund
                  </Button>
                )}
              </div>
            </div>

            {(detail.order.customer_name || detail.order.customer_phone || detail.order.delivery_address) && (
              <div className="bg-slate-50 rounded-xl p-3 space-y-2 border border-slate-100">
                {detail.order.customer_name && (
                  <div className="flex items-center gap-2 text-base font-bold text-slate-900">
                    <UserIcon size={16} className="text-slate-400 shrink-0" /> {detail.order.customer_name}
                  </div>
                )}
                {detail.order.customer_phone && (
                  <a href={`tel:${detail.order.customer_phone}`} className="flex items-center gap-2 text-xl font-extrabold text-slate-900 tabular-nums">
                    <Phone size={18} className="text-emerald-600 shrink-0" /> {detail.order.customer_phone}
                    <span className="text-xs font-semibold bg-emerald-600 text-white px-2 py-1 rounded-full ml-1">CALL</span>
                  </a>
                )}
                {detail.order.delivery_address && (
                  <div className="flex items-start gap-2 text-sm text-slate-700">
                    <MapPin size={16} className="text-slate-400 shrink-0 mt-0.5" /> {detail.order.delivery_address}
                  </div>
                )}
              </div>
            )}

            {canManage && detail.order.order_type === "DELIVERY" && !["COMPLETED", "CANCELLED", "REFUNDED"].includes(detail.order.status) && (
              <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
                <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1.5 flex items-center gap-1">
                  <Truck size={13} /> Rider
                </div>
                <Select
                  value={detail.order.assigned_rider_id ?? ""}
                  onChange={(e) => e.target.value && assignRiderMutation.mutate(e.target.value)}
                  className="w-full"
                >
                  <option value="">{riderOptions?.riders.length ? "Assign a rider…" : "No riders set up yet"}</option>
                  {riderOptions?.riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                    </option>
                  ))}
                </Select>
                {detail.order.status === "READY" && detail.order.assigned_rider_id && (
                  <Button size="sm" className="w-full mt-2" onClick={() => advanceStatusMutation.mutate("OUT_FOR_DELIVERY")}>
                    Send for Delivery
                  </Button>
                )}
              </div>
            )}

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

      <Modal open={!!payTarget} onClose={() => setPayTarget(null)} title={`Collect Payment — Order #${payTarget?.order_number}`}>
        <div className="space-y-3">
          <div className="text-sm text-slate-500">
            Amount due: <span className="font-semibold text-slate-900">{formatPaise(payTarget?.net_total_paise)}</span>
          </div>
          <Select value={payMethodId} onChange={(e) => setPayMethodId(e.target.value)} className="w-full">
            {(pmData?.methods ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Button
            className="w-full"
            disabled={!payMethodId || collectPaymentMutation.isPending}
            onClick={() => collectPaymentMutation.mutate()}
          >
            {collectPaymentMutation.isPending ? "Collecting…" : "Confirm Payment Received"}
          </Button>
        </div>
      </Modal>

      <Modal open={recordPayOpen} onClose={() => setRecordPayOpen(false)} title={`Record Payment — Order #${detail?.order.order_number}`}>
        <div className="space-y-3">
          <div className="text-sm text-slate-500">
            Remaining balance: <span className="font-semibold text-slate-900">{detail?.order ? formatPaise(remainingPaise(detail.order)) : ""}</span>
          </div>
          <Input
            type="number"
            step="0.01"
            placeholder="Amount received (₹)"
            value={recordPayAmount}
            onChange={(e) => setRecordPayAmount(e.target.value)}
            className="w-full"
          />
          <Select value={recordPayMethodId} onChange={(e) => setRecordPayMethodId(e.target.value)} className="w-full">
            {(pmData?.methods ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Button
            className="w-full"
            disabled={!recordPayMethodId || !recordPayAmount || recordPaymentMutation.isPending}
            onClick={() => recordPaymentMutation.mutate()}
          >
            {recordPaymentMutation.isPending ? "Recording…" : "Confirm Payment Received"}
          </Button>
        </div>
      </Modal>

      <Modal open={!!refundTarget} onClose={() => setRefundTarget(null)} title={`Refund — Order #${refundTarget?.order_number}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            This order is already completed — a refund reverses the sale and cash/bank ledger correctly, instead of cancelling (which is only for
            orders that were never paid).
          </p>
          <div className="text-sm text-slate-500">
            Order total: <span className="font-semibold text-slate-900">{refundTarget && formatPaise(refundTarget.net_total_paise)}</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setRefundType("FULL");
                if (refundTarget) setRefundAmount((refundTarget.net_total_paise / 100).toFixed(2));
              }}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${refundType === "FULL" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Full refund
            </button>
            <button
              onClick={() => setRefundType("PARTIAL")}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${refundType === "PARTIAL" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Partial refund
            </button>
          </div>
          <Input
            type="number"
            step="0.01"
            placeholder="Refund amount (₹)"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            disabled={refundType === "FULL"}
            className="w-full"
          />
          <Select value={refundMethodId} onChange={(e) => setRefundMethodId(e.target.value)} className="w-full">
            <option value="">Refund via…</option>
            {(pmData?.methods ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input placeholder="Reason (required)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} className="w-full" />
          <Button
            variant="danger"
            className="w-full"
            disabled={!refundReason || !refundMethodId || !refundAmount || refundMutation.isPending}
            onClick={() => refundMutation.mutate()}
          >
            {refundMutation.isPending ? "Processing…" : "Confirm Refund"}
          </Button>
        </div>
      </Modal>

      <ShareBillModal order={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}
