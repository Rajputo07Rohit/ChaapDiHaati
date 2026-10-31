import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Banknote, CheckCircle2, Clock, Globe, MapPin, Phone, Smartphone, User, Wallet } from "lucide-react";
import { api, ApiError } from "../api/client";
import { PaymentMethod, SalesOrder } from "../api/types";
import { PaymentModeBanner, customerNoteOf } from "../components/PaymentModeBanner";
import { Button, Input, OrderTypeBadge, PackingBadge, StallBadge, PageHeader } from "../components/ui/Primitives";
import { PENDING_WEB_ORDERS_KEY, usePendingWebOrders } from "../components/WebOrderNotifier";
import { CancelNotifyModal, CancelNotice } from "../components/CancelNotifyModal";
import { formatPaise } from "../utils/money";

const PREP_OPTIONS = [15, 25, 40, 60];
/** Prepaid stall orders wait up to 15 min for the customer to pay; flag them as urgent near the end of that window. */
const PREPAID_URGENT_MINUTES = 10;

/** A prepaid order that still needs its payment confirmed before it can go to the kitchen. */
const awaitingPayment = (o: SalesOrder) => !!o.prepayment_required && o.payment_status !== "PAID";
const DEFAULT_PREP = 25;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function waitingLabel(createdAt: string, now: number) {
  const secs = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
  return `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s`;
}

function WebOrderCard({
  order,
  prepMinutes,
  onPrepChange,
  now,
  onDenied,
  paymentMethods,
}: {
  paymentMethods: PaymentMethod[];
  order: SalesOrder;
  prepMinutes: number;
  onPrepChange: (minutes: number) => void;
  now: number;
  onDenied: (notice: CancelNotice) => void;
}) {
  const queryClient = useQueryClient();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("Denied by restaurant");
  const waitingMins = Math.floor((now - new Date(order.created_at).getTime()) / 60000);
  const prepaid = awaitingPayment(order);
  const urgent = waitingMins >= (prepaid ? PREPAID_URGENT_MINUTES : 3);
  const [methodId, setMethodId] = useState<string | null>(null);
  const selectedMethodId = methodId ?? paymentMethods[0]?.id ?? "";
  const selectedMethod = paymentMethods.find((m) => m.id === selectedMethodId);
  const items = (order.items ?? []).filter((i) => i.status === "ACTIVE");

  const done = (msg: string) => {
    toast.success(msg);
    queryClient.invalidateQueries({ queryKey: PENDING_WEB_ORDERS_KEY });
    queryClient.invalidateQueries({ queryKey: ["orders"] });
  };
  const fail = (fallback: string) => (err: unknown) => toast.error(err instanceof ApiError ? err.message : fallback);

  const accept = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/accept`, { prepTimeMinutes: prepMinutes }),
    onSuccess: () => done(`Order #${order.order_number} accepted`),
    onError: fail("Could not accept order"),
  });
  const confirmPayment = useMutation({
    mutationFn: () =>
      api.post(`/orders/${order.id}/confirm-payment`, {
        payments: [{ paymentMethodId: selectedMethodId, amountPaise: order.net_total_paise }],
        prepTimeMinutes: prepMinutes,
      }),
    onSuccess: () => done(`Payment confirmed — order #${order.order_number} sent to the kitchen`),
    onError: fail("Could not confirm payment"),
  });
  const deny = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/cancel`, { reason }),
    onSuccess: () => {
      done(`Order #${order.order_number} denied`);
      // Lifted to the page: this card unmounts as soon as the order leaves the pending list.
      if (order.customer_phone) onDenied({ order, reason, wasDenied: true });
    },
    onError: fail("Could not deny order"),
  });
  const busy = accept.isPending || deny.isPending || confirmPayment.isPending;

  return (
    <div
      className={`rounded-2xl border-2 bg-white shadow-sm overflow-hidden flex flex-col ${urgent ? "border-rose-400" : "border-slate-200"}`}
    >
      <div className={`flex items-center justify-between px-4 py-3 ${urgent ? "bg-rose-50" : "bg-slate-50"}`}>
        <span className="text-xl font-extrabold text-slate-900">#{order.order_number}</span>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold uppercase tabular-nums ${
            urgent ? "bg-rose-600 text-white" : "bg-slate-200 text-slate-600"
          }`}
        >
          <Clock size={12} /> {waitingLabel(order.created_at, now)}
        </span>
      </div>

      {prepaid && (
        <div className="flex items-center gap-2 bg-amber-400 px-4 py-2 text-sm font-bold text-amber-950">
          <Wallet size={16} className="shrink-0" />
          Prepaid · collect {formatPaise(order.net_total_paise)} before cooking
        </div>
      )}

      <div className="px-4 py-2 border-b border-slate-100 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <OrderTypeBadge type={order.order_type} prefix="Web · " />
            <PaymentModeBanner order={order} />
            <PackingBadge order={order} />
            <StallBadge order={order} />
          </span>
          <span className="text-sm font-bold tabular-nums">{formatPaise(order.net_total_paise)}</span>
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

      <div className="flex-1 px-4 py-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-2">
            <div>
              <span className="text-base font-bold text-slate-900">{item.item_name_snapshot}</span>
              {item.price_type !== "SINGLE" && <span className="text-sm text-slate-500"> ({item.price_type})</span>}
              {(item.addons ?? []).length > 0 && <div className="text-sm text-slate-600">+ {item.addons.map((a) => a.name).join(", ")}</div>}
              {item.special_instructions && <div className="text-sm text-amber-700 font-medium">Note: {item.special_instructions}</div>}
            </div>
            <span className="text-lg font-extrabold text-brand-600 tabular-nums shrink-0">×{item.quantity}</span>
          </div>
        ))}
      </div>

      {customerNoteOf(order.notes) && (
        <div className="mx-4 mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-800">
          Special instructions: {customerNoteOf(order.notes)}
        </div>
      )}

      <div className="p-3 border-t border-slate-100 space-y-2">
        {!denying ? (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-semibold text-slate-500">Ready in:</span>
              {PREP_OPTIONS.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={busy}
                  onClick={() => onPrepChange(m)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                    prepMinutes === m ? "bg-brand-600 text-white border-brand-600" : "border-slate-300 text-slate-700 hover:border-slate-400"
                  }`}
                >
                  {m} min
                </button>
              ))}
            </div>
            {prepaid && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-500">Paid by:</span>
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setMethodId(m.id)}
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                      selectedMethodId === m.id ? "bg-emerald-600 text-white border-emerald-600" : "border-slate-300 text-slate-700 hover:border-slate-400"
                    }`}
                  >
                    {m.type === "CASH" ? <Banknote size={12} /> : <Smartphone size={12} />}
                    {m.name}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {prepaid ? (
                <Button
                  className="flex-[2] !bg-emerald-600 hover:!bg-emerald-700"
                  disabled={busy || !selectedMethodId}
                  onClick={() => confirmPayment.mutate()}
                  title={`Records ${formatPaise(order.net_total_paise)} via ${selectedMethod?.name ?? "the selected method"} and sends the order to the kitchen`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle2 size={16} />
                    {confirmPayment.isPending ? "Confirming…" : `${formatPaise(order.net_total_paise)} received → Kitchen`}
                  </span>
                </Button>
              ) : (
                <Button className="flex-1" disabled={busy} onClick={() => accept.mutate()}>
                  {accept.isPending ? "Accepting…" : "Accept → Kitchen"}
                </Button>
              )}
              <Button variant="danger" className="flex-1" disabled={busy} onClick={() => setDenying(true)}>
                Deny
              </Button>
            </div>
            {prepaid && <p className="text-[11px] text-slate-500">Only tap after the customer has paid. Unpaid orders cancel themselves after 15 min.</p>}
          </>
        ) : (
          <>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full" placeholder="Reason" />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setDenying(false)} disabled={busy}>
                Back
              </Button>
              <Button variant="danger" className="flex-1" disabled={!reason.trim() || busy} onClick={() => deny.mutate()}>
                {deny.isPending ? "Denying…" : "Confirm Deny"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function WebOrders() {
  const queryClient = useQueryClient();
  const now = useNow();
  // Each order carries its own "ready in" time, chosen on its card.
  const [prepById, setPrepById] = useState<Record<string, number>>({});
  const prepFor = (id: string) => prepById[id] ?? DEFAULT_PREP;
  const { data, isLoading } = usePendingWebOrders();
  const orders = [...(data?.orders ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const { data: methodsData } = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods"),
    staleTime: 5 * 60_000,
  });
  const paymentMethods = (methodsData?.methods ?? []).filter((m) => m.active);
  // Prepaid orders waiting for payment can't be bulk-accepted — each needs its payment confirmed.
  const acceptable = orders.filter((o) => !awaitingPayment(o));

  const [denyNotice, setDenyNotice] = useState<CancelNotice | null>(null);
  const acceptAll = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(acceptable.map((o) => api.post(`/orders/${o.id}/accept`, { prepTimeMinutes: prepFor(o.id) })));
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (n) => {
      toast.success(`${n} order${n === 1 ? "" : "s"} accepted`);
      queryClient.invalidateQueries({ queryKey: PENDING_WEB_ORDERS_KEY });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Web Orders"
        description="Orders placed by customers online. Accept to send to the kitchen, or deny. Oldest first."
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            {acceptable.length > 1 && (
              <Button disabled={acceptAll.isPending} onClick={() => acceptAll.mutate()}>
                {acceptAll.isPending ? "Accepting…" : `Accept all ${acceptable.length}`}
              </Button>
            )}
          </div>
        }
      />
      {isLoading && <div className="text-center text-slate-400 py-16">Loading…</div>}
      {!isLoading && orders.length === 0 && (
        <div className="text-center text-slate-400 py-24">
          <Globe size={48} className="mx-auto mb-3 opacity-40" />
          <div className="text-lg font-medium">No web orders waiting.</div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
        {orders.map((o) => (
          <WebOrderCard
            key={o.id}
            order={o}
            prepMinutes={prepFor(o.id)}
            onPrepChange={(m) => setPrepById((prev) => ({ ...prev, [o.id]: m }))}
            now={now}
            onDenied={setDenyNotice}
            paymentMethods={paymentMethods}
          />
        ))}
      </div>
      <CancelNotifyModal notice={denyNotice} onClose={() => setDenyNotice(null)} />
    </div>
  );
}
