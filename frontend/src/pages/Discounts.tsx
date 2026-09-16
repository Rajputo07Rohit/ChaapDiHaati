import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { DiscountRule, DiscountType, MenuCategory } from "../api/types";
import { Badge, Button, Card, Input, Modal, PageHeader } from "../components/ui/Primitives";

function describeScope(rule: DiscountRule, categories: MenuCategory[]): string {
  const catNames = rule.categoryIds.map((id) => categories.find((c) => c.id === id)?.name ?? "?");
  const itemNames = rule.menuItemIds.map((id) => categories.flatMap((c) => c.items).find((i) => i.id === id)?.name ?? "?");
  return [...catNames, ...itemNames].join(", ") || "Nothing selected";
}

function describeValue(rule: DiscountRule): string {
  return rule.discountType === "PERCENTAGE" ? `${rule.discountValue}% off` : `₹${(rule.discountValue / 100).toFixed(2)} off`;
}

export function Discounts() {
  const queryClient = useQueryClient();
  const { data: menuData } = useQuery({ queryKey: ["menu"], queryFn: () => api.get<{ categories: MenuCategory[] }>("/menu") });
  const { data: discountData } = useQuery({ queryKey: ["discounts", "all"], queryFn: () => api.get<{ discounts: DiscountRule[] }>("/discounts/all") });
  const [newOpen, setNewOpen] = useState(false);

  const categories = (menuData?.categories ?? []).filter((c) => c.name !== "System");
  const discounts = discountData?.discounts ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["discounts"] });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/discounts/${id}`, { active }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update discount"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/discounts/${id}`),
    onSuccess: () => {
      toast.success("Discount deleted");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not delete discount"),
  });

  return (
    <div>
      <PageHeader
        title="Discounts"
        description="Define discounts on specific products or whole categories. Staff apply and remove these from the POS cart at checkout."
        actions={<Button onClick={() => setNewOpen(true)}>+ New Discount</Button>}
      />
      {discounts.length === 0 ? (
        <p className="text-sm text-slate-400">No discounts yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {discounts.map((rule) => (
            <Card key={rule.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-slate-800 truncate">{rule.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{describeValue(rule)}</div>
                  <div className="text-xs text-slate-400 mt-0.5 truncate" title={describeScope(rule, categories)}>
                    {describeScope(rule, categories)}
                  </div>
                </div>
                <button title="Delete" onClick={() => remove.mutate(rule.id)} className="text-slate-300 hover:text-rose-500 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <Badge tone={rule.active ? "green" : "yellow"}>{rule.active ? "Active" : "Disabled"}</Badge>
                <button
                  onClick={() => toggleActive.mutate({ id: rule.id, active: !rule.active })}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  {rule.active ? "Disable" : "Enable"}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <NewDiscountModal open={newOpen} onClose={() => setNewOpen(false)} onSaved={invalidate} categories={categories} />
    </div>
  );
}

function NewDiscountModal({
  open,
  onClose,
  onSaved,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  categories: MenuCategory[];
}) {
  const [name, setName] = useState("");
  const [discountType, setDiscountType] = useState<DiscountType>("PERCENTAGE");
  const [value, setValue] = useState("");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [menuItemIds, setMenuItemIds] = useState<string[]>([]);

  function reset() {
    setName("");
    setDiscountType("PERCENTAGE");
    setValue("");
    setCategoryIds([]);
    setMenuItemIds([]);
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.post("/discounts", {
        name,
        discountType,
        discountValue: discountType === "PERCENTAGE" ? parseFloat(value) || 0 : Math.round((parseFloat(value) || 0) * 100),
        categoryIds,
        menuItemIds,
      }),
    onSuccess: () => {
      toast.success(`"${name}" discount created`);
      reset();
      onSaved();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not create discount"),
  });

  function toggleCategory(id: string) {
    setCategoryIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  }
  function toggleItem(id: string) {
    setMenuItemIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  }

  const valid = name.trim().length > 0 && parseFloat(value) > 0 && (categoryIds.length > 0 || menuItemIds.length > 0);

  return (
    <Modal open={open} onClose={onClose} title="New Discount">
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">Discount name</label>
          <Input placeholder="e.g. 10% off Chaap Rolls" value={name} onChange={(e) => setName(e.target.value)} className="w-full" autoFocus />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Type</label>
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => setDiscountType("PERCENTAGE")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg ${discountType === "PERCENTAGE" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Percentage
            </button>
            <button
              onClick={() => setDiscountType("FLAT")}
              className={`flex-1 text-sm px-3 py-2 rounded-lg ${discountType === "FLAT" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Flat ₹ off
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">{discountType === "PERCENTAGE" ? "Percent off (0-100)" : "Amount off (₹)"}</label>
          <Input type="number" min={0} value={value} onChange={(e) => setValue(e.target.value)} className="w-full" />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Applies to whole categories</label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => toggleCategory(cat.id)}
                className={`text-xs px-2.5 py-1.5 rounded-lg ${categoryIds.includes(cat.id) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Or specific products</label>
          <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 mt-1 border border-slate-100 rounded-lg p-2">
            {categories.flatMap((cat) =>
              cat.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleItem(item.id)}
                  className={`text-xs px-2.5 py-1.5 rounded-lg ${menuItemIds.includes(item.id) ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {item.name}
                </button>
              ))
            )}
          </div>
        </div>

        <Button className="w-full" disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? "Creating…" : "Create Discount"}
        </Button>
      </div>
    </Modal>
  );
}
