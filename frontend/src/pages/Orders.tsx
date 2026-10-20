import { Fragment, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, Phone, MapPin, User as UserIcon, Truck, Calendar, Eye, EyeOff } from "lucide-react";
import { api, ApiError } from "../api/client";
import { OrderStatus, PaymentMethod, SalesOrder } from "../api/types";
import { formatPaise } from "../utils/money";
import { printReceipt } from "../utils/receipt";
import { Button, Card, EmptyState, Input, KitchenStatusBadge, effectiveOrderStatus, Modal, ORDER_TYPE_STYLE, OrderStatusBadge, OrderTypeBadge, PackingBadge, PageHeader, PaymentStatusBadge, Select } from "../components/ui/Primitives";
import { ShareBillModal } from "../components/ShareBillModal";
import { customerNoteOf } from "../components/PaymentModeBanner";
import { CancelNotifyModal, CancelNotice } from "../components/CancelNotifyModal";
import { InventoryMissingDialog } from "../components/InventoryMissingDialog";
import { useAuth } from "../context/AuthContext";
import { defaultPaymentMethodId } from "../utils/paymentDefaults";
import { toDdMmYyyy } from "../utils/date";

/** A short label for what actually paid for the order — the payment
 * method(s)' names if all the same type, "Mixed" if it spans both Cash and
 * Online methods, or "Unpaid" if nothing's been collected yet. */
function paymentModeLabel(order: SalesOrder): string {
  const payments = order.payments ?? [];
  if (payments.length === 0) return "Unpaid";
  const types = new Set(payments.map((p) => p.payment_method_type));
  if (types.size > 1) return "Mixed";
  const names = [...new Set(payments.map((p) => p.payment_method_name))];
  return names.join(" + ");
}

const LATE_DELIVERY_MINUTES = 45;
const NOT_SALES_STATUSES: OrderStatus[] = ["CANCELLED", "REFUNDED", "DRAFT", "PENDING_ACCEPTANCE"];

/** Delivery progress for the Orders table: delivered (with how long it took), on the way (turns red when late), or no rider yet. */
function DeliveryProgress({ order }: { order: SalesOrder }) {
  if (order.order_type !== "DELIVERY" || ["CANCELLED", "REFUNDED", "DRAFT", "PENDING_ACCEPTANCE"].includes(order.status)) {
    return <span className="text-slate-300">—</span>;
  }
  const created = new Date(order.created_at).getTime();
  if (order.delivered_at) {
    const mins = Math.max(0, Math.round((new Date(order.delivered_at).getTime() - created) / 60000));
    return (
      <span className="inline-flex flex-col leading-tight">
        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ Delivered</span>
        <span className={`mt-0.5 text-[11px] font-medium ${mins > LATE_DELIVERY_MINUTES ? "text-rose-600" : "text-slate-500"}`}>in {mins} min</span>
      </span>
    );
  }
  if (order.status === "COMPLETED") {
    // Completed at the counter / before delivery tracking existed.
    return <span className="text-slate-400 text-xs">Completed</span>;
  }
  const waiting = Math.max(0, Math.floor((Date.now() - created) / 60000));
  const late = waiting > LATE_DELIVERY_MINUTES;
  const label = !order.assigned_rider_id ? "No rider" : order.kitchen_status === "READY" ? "On the way" : "Preparing";
  return (
    <span className="inline-flex flex-col leading-tight">
      <span
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${
          late ? "bg-rose-600 text-white" : "bg-amber-100 text-amber-700"
        }`}
      >
        {late ? "⚠ Late · " : ""}
        {label}
      </span>
      <span className={`mt-0.5 text-[11px] font-medium ${late ? "text-rose-600" : "text-slate-500"}`}>{waiting} min so far</span>
    </span>
  );
}

interface DaySummary {
  business_date: string;
  orders_count: number;
  sales_paise: number;
  cash_paise: number;
  online_paise: number;
  unpaid_paise: number;
  cancelled_count: number;
  cancelled_paise: number;
  pending_acceptance_count: number;
}

export function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("");
  const [businessDate, setBusinessDate] = useState("");
  const [paymentMode, setPaymentMode] = useState<"" | "CASH" | "ONLINE">("");
  const [deliveryFilter, setDeliveryFilter] = useState<"" | "DONE" | "PENDING" | "LATE">("");
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
  const [showTotals, setShowTotals] = useState(false);

  const { data: pmData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods"),
  });

  // Whole-day totals come from the backend (over every order of the day), so
  // they stay correct no matter how many rows the table has loaded.
  const canSeeSales = user?.role === "ADMIN" || !!user?.isSuperAdmin;
  const { data: summaryData } = useQuery({
    enabled: canSeeSales,
    queryKey: ["orders-day-summary", businessDate],
    queryFn: () =>
      api.get<{ summary: DaySummary }>(`/orders/day-summary${businessDate ? `?businessDate=${businessDate}` : ""}`),
    refetchInterval: 10_000,
  });
  const summary = summaryData?.summary;

  // Infinite scroll: pages of PAGE_SIZE, newest first, each page keyed off the
  // createdAt of the last order of the previous one.
  const PAGE_SIZE = 50;
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["orders", status, businessDate],
    initialPageParam: "" as string,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), lite: "1" });
      if (status) params.set("status", status);
      if (businessDate) params.set("businessDate", businessDate);
      if (pageParam) params.set("before", pageParam);
      return api.get<{ orders: SalesOrder[] }>(`/orders?${params.toString()}`);
    },
    getNextPageParam: (lastPage) =>
      lastPage.orders.length < PAGE_SIZE ? undefined : lastPage.orders[lastPage.orders.length - 1].created_at,
    // Polling re-fetches every loaded page, so stop once the user has scrolled
    // deep into history (they're reading old orders, not watching live ones).
    refetchInterval: (query) => ((query.state.data?.pages.length ?? 0) > 2 ? false : 5_000),
    refetchIntervalInBackground: true,
  });
  const allOrders = data?.pages.flatMap((p) => p.orders) ?? [];

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !hasNextPage) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage();
      },
      { root: scrollRef.current, rootMargin: "400px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, allOrders.length]);

  const isDeliveryOpen = (o: SalesOrder) =>
    o.order_type === "DELIVERY" && !o.delivered_at && !["CANCELLED", "REFUNDED", "COMPLETED", "DRAFT", "PENDING_ACCEPTANCE"].includes(o.status);
  const filteredOrders = allOrders
    .filter((o) => !paymentMode || (o.payments ?? []).some((p) => p.payment_method_type === paymentMode))
    .filter((o) => {
      if (!deliveryFilter) return true;
      if (deliveryFilter === "DONE") return o.order_type === "DELIVERY" && !!o.delivered_at;
      if (deliveryFilter === "PENDING") return isDeliveryOpen(o);
      return isDeliveryOpen(o) && Date.now() - new Date(o.created_at).getTime() > LATE_DELIVERY_MINUTES * 60000;
    });

  // Sales total of the rows on screen — same rule as the backend day summary:
  // cancelled/refunded/unaccepted orders don't count. With a payment-mode
  // filter, only the money taken in that mode counts (split payments).
  const hasListFilter = !!(status || paymentMode || deliveryFilter);
  const salesOf = (list: SalesOrder[]) =>
    list
      .filter((o) => !NOT_SALES_STATUSES.includes(o.status))
      .reduce(
        (sum, o) =>
          sum +
          (paymentMode
            ? (o.payments ?? []).filter((p) => p.payment_method_type === paymentMode).reduce((s, p) => s + p.amount_paise, 0)
            : o.net_total_paise),
        0
      );

  // Group into date sections so a flat 100-order list doesn't blur today's
  // orders together with yesterday's — this is purely a display grouping,
  // the underlying list/query is unchanged.
  const ordersByDate: [string, SalesOrder[]][] = [];
  for (const o of filteredOrders) {
    const group = ordersByDate.find(([d]) => d === o.business_date);
    if (group) group[1].push(o);
    else ordersByDate.push([o.business_date, [o]]);
  }

  const { data: detail } = useQuery({
    queryKey: ["order", selected?.id],
    queryFn: () => api.get<{ order: SalesOrder }>(`/orders/${selected!.id}`),
    enabled: !!selected,
    // A rider can complete/deliver this exact order from their own phone
    // while an admin/staff has it open here watching — poll so that shows
    // up without needing a manual reload.
    refetchInterval: 4_000,
  });

  const [cancelNotice, setCancelNotice] = useState<CancelNotice | null>(null);

  const cancelMutation = useMutation({
    mutationFn: () => api.post(`/orders/${cancelTarget!.id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      toast.success("Order cancelled");
      // Offer the WhatsApp heads-up only when there's a customer to tell —
      // walk-in dine-in orders usually have no number.
      if (cancelTarget?.customer_phone) {
        setCancelNotice({ order: cancelTarget, reason: cancelReason, wasDenied: cancelTarget.status === "PENDING_ACCEPTANCE" });
      }
      setCancelTarget(null);
      setCancelReason("");
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not cancel order"),
  });

  const retryRefundMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/retry-refund`),
    onSuccess: () => {
      toast.success("Refund sent to Cashfree again");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not retry the refund"),
  });

  const [missingInventory, setMissingInventory] = useState<string[] | null>(null);
  const [deliverMissingInventory, setDeliverMissingInventory] = useState<{ orderId: string; missingItems: string[] } | null>(null);

  const staffDeliverMutation = useMutation({
    mutationFn: ({ orderId, bypassMissingInventory }: { orderId: string; bypassMissingInventory?: boolean }) =>
      api.post(`/orders/${orderId}/deliver`, bypassMissingInventory ? { bypassMissingInventory: true } : undefined),
    onSuccess: () => {
      toast.success("Order delivered & completed");
      setDeliverMissingInventory(null);
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err, vars) => {
      if (err instanceof ApiError && err.code === "INVENTORY_ITEMS_MISSING") {
        setDeliverMissingInventory({ orderId: vars.orderId, missingItems: (err.details as { missingItems?: string[] } | undefined)?.missingItems ?? [] });
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Could not mark delivered");
    },
  });

  const collectPaymentMutation = useMutation({
    mutationFn: (bypassMissingInventory?: boolean) =>
      api.post(`/orders/${payTarget!.id}/complete`, {
        payments: [{ paymentMethodId: payMethodId, amountPaise: payTarget!.net_total_paise }],
        ...(bypassMissingInventory ? { bypassMissingInventory: true } : {}),
      }),
    onSuccess: () => {
      toast.success("Payment collected — order completed");
      setPayTarget(null);
      setPayMethodId("");
      setMissingInventory(null);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "INVENTORY_ITEMS_MISSING") {
        setMissingInventory((err.details as { missingItems?: string[] } | undefined)?.missingItems ?? []);
        return;
      }
      toast.error(err instanceof ApiError ? err.message : "Could not collect payment");
    },
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

  // Refund, Cancel, and rider-assignment are all open to any signed-in
  // staff-side role (Admin/Manager/Staff) — Riders never reach this page at all.
  const canManage = user?.role === "ADMIN" || user?.role === "MANAGER" || user?.role === "STAFF";
  const canRefund = canManage;

  const { data: riderOptions } = useQuery({
    queryKey: ["rider-options"],
    queryFn: () => api.get<{ riders: { id: string; fullName: string }[] }>("/orders/rider/options"),
    enabled: canManage,
  });

  // Picking a rider is the only step needed for a delivery order now — the
  // backend also accepts (if still pending) and dispatches it in this same
  // call, so it shows up on that rider's phone immediately.
  const assignRiderMutation = useMutation({
    mutationFn: (riderId: string) => api.post(`/orders/${detail!.order.id}/assign-rider`, { riderId }),
    onSuccess: () => {
      toast.success("Rider assigned — order sent out for delivery");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not assign rider"),
  });

  const acceptMutation = useMutation({
    mutationFn: (orderId: string) => api.post(`/orders/${orderId}/accept`, undefined),
    onSuccess: () => {
      toast.success("Order accepted");
      queryClient.invalidateQueries({ queryKey: ["order", selected?.id] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not accept order"),
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
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <Input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
              {businessDate && <span className="text-xs text-slate-500 font-medium tabular-nums">{toDdMmYyyy(businessDate)}</span>}
            </div>
            {businessDate && (
              <button onClick={() => setBusinessDate("")} className="text-xs text-slate-400 hover:text-slate-600">
                Clear date
              </button>
            )}
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {["DRAFT", "PENDING_ACCEPTANCE", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "COMPLETED", "CANCELLED", "REFUNDED"].map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
            <Select value={deliveryFilter} onChange={(e) => setDeliveryFilter(e.target.value as "" | "DONE" | "PENDING" | "LATE")}>
              <option value="">All deliveries</option>
              <option value="PENDING">Delivery pending</option>
              <option value="LATE">Delivery late ({LATE_DELIVERY_MINUTES}+ min)</option>
              <option value="DONE">Delivered</option>
            </Select>
            <Select value={paymentMode} onChange={(e) => setPaymentMode(e.target.value as "" | "CASH" | "ONLINE")}>
              <option value="">All payment modes</option>
              <option value="CASH">Cash</option>
              <option value="ONLINE">Online</option>
            </Select>
            {canSeeSales && (
            <button
              onClick={() => setShowTotals((v) => !v)}
              title={showTotals ? "Hide totals" : "Show totals"}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg px-2.5 py-2"
            >
              {showTotals ? <EyeOff size={14} /> : <Eye size={14} />}
              {showTotals ? "Hide totals" : "Show totals"}
            </button>
            )}
          </div>
        }
      />

      {canSeeSales && summary && (
        <div className="mb-3 inline-flex items-baseline gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm">
          <span className="font-semibold text-slate-600">Total sales {toDdMmYyyy(summary.business_date)}</span>
          <span className="font-bold tabular-nums text-brand-700">{showTotals ? formatPaise(summary.sales_paise) : "••••••"}</span>
          <span className="text-xs text-slate-500">({summary.orders_count} orders)</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <div ref={scrollRef} className="overflow-auto max-h-[calc(100vh-18rem)] min-h-[20rem]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-2.5">Order #</th>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Type</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Kitchen</th>
                <th className="text-left px-4 py-2.5">Delivery</th>
                <th className="text-left px-4 py-2.5">Payment</th>
                <th className="text-left px-4 py-2.5">Mode</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ordersByDate.map(([date, dateOrders], dayIndex) => (
                <Fragment key={date}>
                  <tr key={`hdr-${date}`}>
                    <td colSpan={11} className="sticky top-0 z-10 bg-slate-800 px-4 py-2 text-sm font-bold text-white">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Calendar size={14} />
                          {toDdMmYyyy(date)}
                          <span className="font-normal text-slate-300">
                            · {dateOrders.length} order{dateOrders.length > 1 ? "s" : ""}
                            {hasNextPage && dayIndex === ordersByDate.length - 1 ? " so far (scroll for more)" : ""}
                          </span>
                        </div>
                        <span className="tabular-nums">
                          {!canSeeSales ? null : showTotals
                            ? formatPaise(
                                summary && summary.business_date === date && !hasListFilter
                                  ? summary.sales_paise
                                  : salesOf(dateOrders)
                              )
                            : "••••••"}
                        </span>
                      </div>
                    </td>
                  </tr>
                  {dateOrders.map((o) => (
                <tr key={o.id} className={`hover:bg-slate-50 cursor-pointer border-l-4 ${ORDER_TYPE_STYLE[o.order_type]?.stripe ?? "border-l-transparent"}`} onClick={() => setSelected(o)}>
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
                  <td className="px-4 py-2.5 text-slate-500 tabular-nums">{toDdMmYyyy(o.business_date)}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-1">
                      <OrderTypeBadge type={o.order_type} />
                      <PackingBadge order={o} />
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <OrderStatusBadge status={effectiveOrderStatus(o)} />
                  </td>
                  <td className="px-4 py-2.5">
                    {["CANCELLED", "REFUNDED"].includes(o.status) ? <span className="text-slate-300">—</span> : <KitchenStatusBadge status={o.kitchen_status} />}
                  </td>
                  <td className="px-4 py-2.5">
                    <DeliveryProgress order={o} />
                  </td>
                  <td className="px-4 py-2.5">
                    <PaymentStatusBadge status={o.payment_status} />
                    <RefundBadge order={o} />
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{paymentModeLabel(o)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(o.net_total_paise)}</td>
                  <td className="px-4 py-2.5 text-right space-x-1.5 whitespace-nowrap">
                    {canManage && o.status === "PENDING_ACCEPTANCE" && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          acceptMutation.mutate(o.id);
                        }}
                        disabled={acceptMutation.isPending}
                      >
                        Accept
                      </Button>
                    )}
                    {canManage && o.order_type !== "DELIVERY" && ["CONFIRMED", "PREPARING", "READY"].includes(o.status) && (
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPayTarget(o);
                          setPayMethodId(defaultPaymentMethodId(o.order_type, pmData?.methods ?? []));
                        }}
                      >
                        Collect Payment
                      </Button>
                    )}
                    {canManage && ["DRAFT", "PENDING_ACCEPTANCE", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY"].includes(o.status) && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCancelTarget(o);
                        }}
                      >
                        {o.status === "PENDING_ACCEPTANCE" ? "Deny" : "Cancel"}
                      </Button>
                    )}
                  </td>
                </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
          {!isLoading && filteredOrders.length === 0 && <EmptyState title="No orders found" description="Try a different filter." />}
          <div ref={loadMoreRef} className="py-4 text-center text-xs text-slate-400">
            {isFetchingNextPage ? (
              "Loading older orders…"
            ) : hasNextPage ? (
              <button onClick={() => fetchNextPage()} className="font-semibold text-brand-600 hover:underline">
                Load older orders
              </button>
            ) : (
              filteredOrders.length > 0 && `That's everything · ${allOrders.length} orders`
            )}
          </div>
        </div>
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Order #${selected.order_number}` : ""}>
        {detail?.order && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <OrderStatusBadge status={effectiveOrderStatus(detail.order)} />
                {!["CANCELLED", "REFUNDED"].includes(detail.order.status) && <KitchenStatusBadge status={detail.order.kitchen_status} />}
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
                {detail.order.status === "COMPLETED" && (
                  <Button
                    size="sm"
                    onClick={() =>
                      navigate("/pos", {
                        state: {
                          prefillOrderType: detail.order.order_type,
                          prefillCustomerName: detail.order.customer_name ?? "",
                          prefillCustomerPhone: detail.order.customer_phone ?? "",
                          prefillDeliveryAddress: detail.order.delivery_address ?? "",
                          continuedFromOrderNumber: detail.order.order_number,
                        },
                      })
                    }
                  >
                    Add More Items
                  </Button>
                )}
                {canManage && detail.order.status === "PENDING_ACCEPTANCE" && (
                  <>
                    <Button size="sm" onClick={() => acceptMutation.mutate(detail.order.id)} disabled={acceptMutation.isPending}>
                      Accept Order
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => setCancelTarget(detail.order)}>
                      Deny
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
                      setPayMethodId(defaultPaymentMethodId(detail.order.order_type, pmData?.methods ?? []));
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
                    onClick={() => staffDeliverMutation.mutate({ orderId: detail.order.id })}
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
                  disabled={assignRiderMutation.isPending}
                >
                  <option value="">{riderOptions?.riders.length ? "Assign a rider…" : "No riders set up yet"}</option>
                  {riderOptions?.riders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName}
                    </option>
                  ))}
                </Select>
                {detail.order.assigned_rider_id && detail.order.status !== "OUT_FOR_DELIVERY" && (
                  <p className="mt-1.5 text-xs text-blue-700">Rider assigned — this order is out for delivery.</p>
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
                    {item.special_instructions && <div className="text-xs font-medium text-amber-700">Note: {item.special_instructions}</div>}
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
              {(detail.order.packing_fee_paise ?? 0) > 0 && (
                <div className="flex justify-between text-violet-700">
                  <span>Packing</span>
                  <span className="tabular-nums">+{formatPaise(detail.order.packing_fee_paise)}</span>
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
            {detail.order.refund_status && (
              <div
                className={`rounded p-2 text-xs ${
                  detail.order.refund_status === "FAILED" ? "bg-rose-50 text-rose-700" : detail.order.refund_status === "SUCCESS" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                }`}
              >
                <div className="font-semibold">
                  Online refund {formatPaise(detail.order.refund_amount_paise ?? detail.order.net_total_paise)} —{" "}
                  {detail.order.refund_status === "SUCCESS" ? "completed" : detail.order.refund_status === "PENDING" ? "processing at Cashfree" : "FAILED"}
                </div>
                {detail.order.refund_status === "FAILED" && (
                  <>
                    <div className="mt-0.5">{detail.order.refund_error ?? "The refund request didn't go through."} It is retried automatically a few times.</div>
                    {canManage && (
                      <Button size="sm" className="mt-2" disabled={retryRefundMutation.isPending} onClick={() => retryRefundMutation.mutate(detail.order.id)}>
                        Retry refund now
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
            {customerNoteOf(detail.order.notes) && <div className="text-xs text-slate-400">Note: {customerNoteOf(detail.order.notes)}</div>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title={cancelTarget?.status === "PENDING_ACCEPTANCE" ? `Deny Order #${cancelTarget?.order_number}` : `Cancel Order #${cancelTarget?.order_number}`}
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            A reason is required. {cancelTarget?.status === "PENDING_ACCEPTANCE" ? "Denied" : "Cancelled"} orders are never counted as sales.
            {cancelTarget?.payment_status === "PAID" &&
              (/cashfree/i.test(cancelTarget.notes ?? "")
                ? " This customer paid online — the full amount is refunded to their UPI automatically."
                : " Any amount already collected is reversed in the cash/bank ledger.")}
          </p>
          <Input placeholder="Reason" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full" />
          <Button variant="danger" className="w-full" disabled={!cancelReason || cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
            {cancelTarget?.status === "PENDING_ACCEPTANCE" ? "Confirm Denial" : "Confirm Cancellation"}
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
            onClick={() => collectPaymentMutation.mutate(undefined)}
          >
            {collectPaymentMutation.isPending ? "Collecting…" : "Confirm Payment Received"}
          </Button>
        </div>
      </Modal>

      <InventoryMissingDialog
        open={!!missingInventory}
        missingItems={missingInventory ?? []}
        busy={collectPaymentMutation.isPending}
        onCancel={() => setMissingInventory(null)}
        onConfirm={() => collectPaymentMutation.mutate(true)}
      />

      <InventoryMissingDialog
        open={!!deliverMissingInventory}
        missingItems={deliverMissingInventory?.missingItems ?? []}
        busy={staffDeliverMutation.isPending}
        onCancel={() => setDeliverMissingInventory(null)}
        onConfirm={() => deliverMissingInventory && staffDeliverMutation.mutate({ orderId: deliverMissingInventory.orderId, bypassMissingInventory: true })}
      />

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
      <CancelNotifyModal notice={cancelNotice} onClose={() => setCancelNotice(null)} />
    </div>
  );
}

/** Small note under the payment badge when an online refund is in progress or stuck. */
function RefundBadge({ order }: { order: SalesOrder }) {
  if (!order.refund_status) return null;
  const style =
    order.refund_status === "FAILED" ? "text-rose-600" : order.refund_status === "SUCCESS" ? "text-emerald-600" : "text-amber-600";
  const label = order.refund_status === "FAILED" ? "Refund failed — open to retry" : order.refund_status === "SUCCESS" ? "Refunded online" : "Refund processing";
  return <div className={`mt-0.5 text-[11px] font-medium ${style}`}>{label}</div>;
}
