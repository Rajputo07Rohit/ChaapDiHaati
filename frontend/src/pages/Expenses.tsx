import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { Expense, PaymentMethod } from "../api/types";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { useAuth } from "../context/AuthContext";

const CATEGORIES = [
  "Milk", "Curd", "Vegetables", "Gas", "Coal", "Electricity", "Repair", "Maintenance",
  "Staff", "Transport", "Cleaning", "Packaging", "Miscellaneous", "Other",
];

export function Expenses() {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Expense | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["expenses"], queryFn: () => api.get<{ expenses: Expense[] }>("/expenses") });
  const { data: pmData } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods") });

  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [vendor, setVendor] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      api.post("/expenses", {
        category,
        description,
        amountPaise: rupeesToPaise(parseFloat(amount) || 0),
        paymentMethodId,
        vendor: vendor || undefined,
      }),
    onSuccess: () => {
      toast.success("Expense recorded");
      setModalOpen(false);
      setDescription("");
      setAmount("");
      setVendor("");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not record expense"),
  });

  const voidMutation = useMutation({
    mutationFn: () => api.post(`/expenses/${voidTarget!.id}/void`, { reason: voidReason }),
    onSuccess: () => {
      toast.success("Expense voided");
      setVoidTarget(null);
      setVoidReason("");
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not void expense"),
  });

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Operating expenses. These do not affect inventory unless explicitly linked to a purchase."
        actions={<Button onClick={() => setModalOpen(true)}>Record Expense</Button>}
      />
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Category</th>
                <th className="text-left px-4 py-2.5">Description</th>
                <th className="text-left px-4 py-2.5">Payment</th>
                <th className="text-right px-4 py-2.5">Amount</th>
                {isAdmin && <th className="text-right px-4 py-2.5">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data?.expenses ?? []).map((e) => (
                <tr key={e.id} className={`hover:bg-slate-50 ${e.status === "VOID" ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5 text-slate-500">{e.business_date}</td>
                  <td className="px-4 py-2.5">{e.category}</td>
                  <td className="px-4 py-2.5">
                    {e.description}
                    {e.status === "VOID" && (
                      <Badge tone="red">
                        <span className="ml-1">VOID</span>
                      </Badge>
                    )}
                    {e.void_reason && <div className="text-xs text-rose-500 mt-0.5">Voided: {e.void_reason}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500">{e.payment_method_name}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatPaise(e.amount_paise)}</td>
                  {isAdmin && (
                    <td className="px-4 py-2.5 text-right">
                      {e.status !== "VOID" && (
                        <Button size="sm" variant="danger" onClick={() => setVoidTarget(e)}>
                          Void
                        </Button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {!isLoading && (data?.expenses.length ?? 0) === 0 && (
            <EmptyState title="No expenses recorded yet" description="Record your first expense to start tracking operating costs." />
          )}
        </div>
      </Card>

      <Modal open={!!voidTarget} onClose={() => setVoidTarget(null)} title="Void Expense">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Entered by mistake? Voiding keeps a permanent record instead of deleting it. A reason is required.
          </p>
          {voidTarget && (
            <div className="text-sm bg-slate-50 rounded-lg p-2.5">
              <div className="font-medium">{voidTarget.description}</div>
              <div className="text-slate-500">
                {voidTarget.category} · {formatPaise(voidTarget.amount_paise)}
              </div>
            </div>
          )}
          <Input placeholder="Reason (e.g. duplicate entry, wrong amount)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="w-full" />
          <Button variant="danger" className="w-full" disabled={!voidReason || voidMutation.isPending} onClick={() => voidMutation.mutate()}>
            {voidMutation.isPending ? "Voiding…" : "Confirm Void"}
          </Button>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Record Expense">
        <div className="space-y-3">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Input placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full" />
          <Input placeholder="Amount ₹" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full" />
          <Select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className="w-full">
            <option value="">Payment method</option>
            {(pmData?.methods ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Input placeholder="Vendor (optional)" value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-full" />
          <Button
            className="w-full"
            disabled={!description || !amount || !paymentMethodId || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Saving…" : "Save Expense"}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
