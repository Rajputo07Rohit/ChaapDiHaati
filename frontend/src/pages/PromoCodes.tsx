import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, ApiError } from "../api/client";
import { Badge, Button, Card, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { formatPaise, rupeesToPaise } from "../utils/money";

interface PromoCode {
  id: string;
  code: string;
  description: string;
  discount_type: "FLAT" | "PERCENTAGE";
  discount_value: number;
  min_order_paise: number;
  usage_limit: number | null;
  used_count: number;
  per_customer_limit: number | null;
  active: boolean;
  expires_at: string | null;
}

function describeValue(c: PromoCode): string {
  return c.discount_type === "PERCENTAGE" ? `${c.discount_value}% off` : `${formatPaise(c.discount_value)} off`;
}

function NewPromoCodeModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [discountType, setDiscountType] = useState<"FLAT" | "PERCENTAGE">("FLAT");
  const [discountValue, setDiscountValue] = useState("");
  const [minOrder, setMinOrder] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("1");
  const [expiresAt, setExpiresAt] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/promo-codes", {
        code,
        description,
        discountType,
        discountValue: discountType === "PERCENTAGE" ? parseFloat(discountValue) || 0 : rupeesToPaise(parseFloat(discountValue) || 0),
        minOrderPaise: minOrder ? rupeesToPaise(parseFloat(minOrder) || 0) : undefined,
        usageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
        perCustomerLimit: perCustomerLimit ? parseInt(perCustomerLimit, 10) : null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    onSuccess: () => {
      toast.success(`Code "${code.toUpperCase()}" created`);
      setCode("");
      setDescription("");
      setDiscountValue("");
      setMinOrder("");
      setUsageLimit("");
      setExpiresAt("");
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create promo code"),
  });

  const valid = code.trim().length >= 2 && description.trim().length > 0 && parseFloat(discountValue) > 0;

  return (
    <Modal open={open} onClose={onClose} title="New Promo Code">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">Code (customers type this)</label>
          <Input placeholder="e.g. WELCOME50" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className="w-full" autoFocus />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Description (shown on the offers banner)</label>
          <Input placeholder="e.g. 50% off on your first order" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">Discount type</label>
            <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as "FLAT" | "PERCENTAGE")} className="w-full">
              <option value="FLAT">Flat ₹ off</option>
              <option value="PERCENTAGE">% off</option>
            </Select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">{discountType === "PERCENTAGE" ? "Percent (1-100)" : "Amount (₹)"}</label>
            <Input type="number" min={0} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">Min order (₹, optional)</label>
            <Input type="number" min={0} value={minOrder} onChange={(e) => setMinOrder(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Expires on (optional)</label>
            <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="w-full" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-medium text-slate-500">Total uses allowed (blank = unlimited)</label>
            <Input type="number" min={1} value={usageLimit} onChange={(e) => setUsageLimit(e.target.value)} className="w-full" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Uses per customer (blank = unlimited)</label>
            <Input type="number" min={1} value={perCustomerLimit} onChange={(e) => setPerCustomerLimit(e.target.value)} className="w-full" />
          </div>
        </div>
        <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Creating…" : "Create Code"}
        </Button>
      </div>
    </Modal>
  );
}

export function PromoCodes() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["promo-codes"], queryFn: () => api.get<{ codes: PromoCode[] }>("/promo-codes") });
  const [newOpen, setNewOpen] = useState(false);
  const codes = data?.codes ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["promo-codes"] });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/promo-codes/${id}`, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update code"),
  });

  return (
    <div>
      <PageHeader
        title="Promo Codes"
        description="Codes customers apply at checkout in the customer app. Discounts are always validated and computed server-side at order time."
        actions={<Button onClick={() => setNewOpen(true)}>+ New Code</Button>}
      />
      {codes.length === 0 ? (
        <p className="text-sm text-slate-400">No promo codes yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {codes.map((c) => {
            const exhausted = c.usage_limit != null && c.used_count >= c.usage_limit;
            const expired = c.expires_at != null && c.expires_at <= new Date().toISOString();
            return (
              <Card key={c.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono font-semibold text-sm text-slate-800">{c.code}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{c.description}</div>
                  </div>
                  {c.active && !exhausted && !expired ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}
                </div>
                <div className="mt-2 text-sm font-medium text-slate-700">{describeValue(c)}</div>
                <div className="mt-1 text-xs text-slate-500 space-y-0.5">
                  {c.min_order_paise > 0 && <div>Min order: {formatPaise(c.min_order_paise)}</div>}
                  <div>
                    Used: {c.used_count}
                    {c.usage_limit != null ? ` / ${c.usage_limit}` : " (unlimited)"}
                  </div>
                  {c.per_customer_limit != null && <div>Max {c.per_customer_limit} per customer</div>}
                  {c.expires_at && <div>Expires: {new Date(c.expires_at).toLocaleDateString()}</div>}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full mt-3"
                  onClick={() => toggleActive.mutate({ id: c.id, active: !c.active })}
                  disabled={toggleActive.isPending}
                >
                  {c.active ? "Deactivate" : "Activate"}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
      <NewPromoCodeModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={invalidate} />
    </div>
  );
}
