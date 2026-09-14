import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { InventoryItem, PaymentMethod, PurchaseItem, PurchaseOrder, Supplier } from "../api/types";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

interface PurchaseLine {
  inventoryItemId: string;
  quantity: string;
  purchaseUnit: string;
  ratePaise: string;
  pricePending: boolean;
}

export function Purchases() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [voidTarget, setVoidTarget] = useState<PurchaseOrder | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["purchases"], queryFn: () => api.get<{ purchases: PurchaseOrder[] }>("/purchases") });
  const { data: detail } = useQuery({
    queryKey: ["purchase", selected?.id],
    queryFn: () => api.get<{ purchase: PurchaseOrder; items: PurchaseItem[] }>(`/purchases/${selected!.id}`),
    enabled: !!selected,
  });

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/purchases/${voidTarget!.id}/void`, { reason: voidReason }),
    onSuccess: () => {
      toast.success(`Purchase ${voidTarget!.purchase_number} voided — stock reversed`);
      setVoidTarget(null);
      setVoidReason("");
      setSelected(null);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not void purchase"),
  });
  const { data: invData } = useQuery({ queryKey: ["inventory-all"], queryFn: () => api.get<{ items: InventoryItem[] }>("/inventory") });
  const { data: supData } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<{ suppliers: Supplier[] }>("/suppliers") });
  const { data: pmData } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods") });

  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<"PAID" | "CREDIT" | "PARTIAL">("PAID");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([{ inventoryItemId: "", quantity: "", purchaseUnit: "", ratePaise: "", pricePending: false }]);

  function resetForm() {
    setSupplierId("");
    setInvoiceNumber("");
    setPaymentStatus("PAID");
    setLines([{ inventoryItemId: "", quantity: "", purchaseUnit: "", ratePaise: "", pricePending: false }]);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/purchases", {
        supplierId: supplierId || undefined,
        invoiceNumber: invoiceNumber || undefined,
        paymentStatus,
        paymentMethodId: paymentStatus !== "CREDIT" ? paymentMethodId : undefined,
        items: lines
          .filter((l) => l.inventoryItemId && l.quantity)
          .map((l) => ({
            inventoryItemId: l.inventoryItemId,
            quantity: parseFloat(l.quantity),
            purchaseUnit: l.purchaseUnit,
            ratePaise: l.pricePending ? null : rupeesToPaise(parseFloat(l.ratePaise) || 0),
            pricePending: l.pricePending,
          })),
      }),
    onSuccess: () => {
      toast.success("Purchase recorded");
      resetForm();
      setModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ["purchases"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record purchase"),
  });

  const items = invData?.items ?? [];

  function updateLine(idx: number, patch: Partial<PurchaseLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function onSelectItem(idx: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateLine(idx, { inventoryItemId: itemId, purchaseUnit: item?.purchase_unit ?? "" });
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Purchases increase inventory. They only become COGS once consumed by a sale."
        actions={<Button onClick={() => setModalOpen(true)}>Record Purchase</Button>}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Purchase #</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5">Total</th>
                <th className="text-right px-4 py-2.5">Paid</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.purchases ?? []).map((p) => (
                <tr key={p.id} className={`hover:bg-slate-50 cursor-pointer ${p.status === "VOID" ? "opacity-50" : ""}`} onClick={() => setSelected(p)}>
                  <td className="px-4 py-2.5 font-medium">{p.purchase_number}</td>
                  <td className="px-4 py-2.5 text-slate-500">{p.business_date}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={p.payment_status === "PAID" ? "green" : p.payment_status === "CREDIT" ? "yellow" : "blue"}>
                      {p.payment_status}
                    </Badge>
                    {p.status === "VOID" && <Badge tone="red">VOID</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(p.total_paise)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(p.amount_paid_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.purchases.length ?? 0) === 0 && <EmptyState title="No purchases recorded yet" description="Record your first purchase to start tracking inventory costs." />}
        </div>
      </Card>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected ? `Purchase ${selected.purchase_number}` : ""}>
        {detail && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone={detail.purchase.payment_status === "PAID" ? "green" : detail.purchase.payment_status === "CREDIT" ? "yellow" : "blue"}>
                  {detail.purchase.payment_status}
                </Badge>
                {detail.purchase.status === "VOID" && <Badge tone="red">VOID</Badge>}
              </div>
              <span className="text-slate-500">{detail.purchase.business_date}</span>
            </div>
            {detail.purchase.invoice_number && <div className="text-xs text-slate-400">Invoice #{detail.purchase.invoice_number}</div>}
            <div className="divide-y divide-slate-100">
              {detail.items.map((item) => (
                <div key={item.id} className="py-2 flex justify-between">
                  <div>
                    <div className="font-medium">
                      {item.item_name} — {item.quantity} {item.purchase_unit}
                    </div>
                    {item.price_pending ? (
                      <div className="text-xs text-amber-600">Price pending</div>
                    ) : (
                      <div className="text-xs text-slate-400">{formatPaise(item.rate_paise ?? 0)}/{item.purchase_unit}</div>
                    )}
                  </div>
                  <span className="tabular-nums">{item.amount_paise != null ? formatPaise(item.amount_paise) : "—"}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between font-semibold pt-1 border-t border-slate-100">
              <span>Total</span>
              <span className="tabular-nums">{formatPaise(detail.purchase.total_paise)}</span>
            </div>
            <div className="flex justify-between text-slate-500">
              <span>Paid</span>
              <span className="tabular-nums">{formatPaise(detail.purchase.amount_paid_paise)}</span>
            </div>
            {detail.purchase.void_reason && (
              <div className="bg-rose-50 text-rose-700 rounded p-2 text-xs">Voided: {detail.purchase.void_reason}</div>
            )}
            {isAdmin && detail.purchase.status !== "VOID" && (
              <Button variant="danger" className="w-full" onClick={() => setVoidTarget(detail.purchase)}>
                Void This Purchase
              </Button>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title={`Void Purchase ${voidTarget?.purchase_number}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Entered by mistake? Voiding reverses the stock this purchase added and keeps a permanent record — nothing is deleted. A reason is
            required.
          </p>
          <Input placeholder="Reason (e.g. duplicate entry, wrong item)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="w-full" />
          <Button variant="danger" className="w-full" disabled={!voidReason || voidMutation.isPending} onClick={() => voidMutation.mutate()}>
            {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
          </Button>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Purchase" wide>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">No supplier</option>
              {(supData?.suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Input placeholder="Invoice number" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as any)}>
              <option value="PAID">Paid now</option>
              <option value="CREDIT">Supplier credit</option>
              <option value="PARTIAL">Partial payment</option>
            </Select>
            {paymentStatus !== "CREDIT" && (
              <Select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">Payment method</option>
                {(pmData?.methods ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Select className="col-span-4" value={line.inventoryItemId} onChange={(e) => onSelectItem(idx, e.target.value)}>
                  <option value="">Select item</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
                <Input className="col-span-2" placeholder="Qty" type="number" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
                <Input className="col-span-2" placeholder="Unit" value={line.purchaseUnit} onChange={(e) => updateLine(idx, { purchaseUnit: e.target.value })} />
                <Input
                  className="col-span-2"
                  placeholder="Rate ₹"
                  type="number"
                  disabled={line.pricePending}
                  value={line.ratePaise}
                  onChange={(e) => updateLine(idx, { ratePaise: e.target.value })}
                />
                <label className="col-span-1 text-xs flex items-center gap-1">
                  <input type="checkbox" checked={line.pricePending} onChange={(e) => updateLine(idx, { pricePending: e.target.checked })} />
                  Pending
                </label>
                <button className="col-span-1 text-slate-300 hover:text-rose-500" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              className="text-xs text-brand-600 font-medium flex items-center gap-1"
              onClick={() => setLines((prev) => [...prev, { inventoryItemId: "", quantity: "", purchaseUnit: "", ratePaise: "", pricePending: false }])}
            >
              <Plus size={14} /> Add line
            </button>
          </div>

          <Button className="w-full" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            Record Purchase
          </Button>
        </div>
      </Modal>
    </div>
  );
}
