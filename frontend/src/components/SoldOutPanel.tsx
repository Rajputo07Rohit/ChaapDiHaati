import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Ban } from "lucide-react";
import { api, ApiError } from "../api/client";
import { MenuCategory, MenuItem } from "../api/types";
import { Input, Modal } from "./ui/Primitives";

/**
 * Kitchen shortcut for "we just ran out": one tap marks an item sold out, so
 * customers see it greyed out and can't order it (and anyone with it in their
 * cart is told before checkout). Same switch as on the Menu page.
 */
export function SoldOutButton() {
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ["menu"], queryFn: () => api.get<{ categories: MenuCategory[] }>("/menu") });
  const outCount = (data?.categories ?? []).flatMap((c) => c.items).filter((i) => i.status === "UNAVAILABLE").length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-red-300 hover:text-red-600"
      >
        <Ban size={14} /> Sold out items{outCount > 0 ? ` (${outCount})` : ""}
      </button>
      <SoldOutModal open={open} onClose={() => setOpen(false)} categories={data?.categories ?? []} />
    </>
  );
}

function SoldOutModal({ open, onClose, categories }: { open: boolean; onClose: () => void; categories: MenuCategory[] }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const toggle = useMutation({
    mutationFn: (item: MenuItem) => api.patch(`/menu/${item.id}/stock`, { inStock: item.status === "UNAVAILABLE" }),
    onSuccess: (_d, item) => {
      toast.success(item.status === "UNAVAILABLE" ? `${item.name} is back` : `${item.name} marked sold out`);
      queryClient.invalidateQueries({ queryKey: ["menu"] });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : "Could not update item"),
  });

  const q = search.trim().toLowerCase();
  const items = categories
    .flatMap((c) => c.items)
    .filter((i) => i.status !== "DISCONTINUED" && (!q || i.name.toLowerCase().includes(q)))
    // Sold-out ones first, so bringing something back is quick.
    .sort((a, b) => Number(b.status === "UNAVAILABLE") - Number(a.status === "UNAVAILABLE") || a.name.localeCompare(b.name));

  return (
    <Modal open={open} onClose={onClose} title="Sold out items">
      <Input placeholder="Search item" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3 w-full" />
      <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
        {items.map((item) => {
          const out = item.status === "UNAVAILABLE";
          return (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2">
              <span className={`text-sm ${out ? "font-semibold text-red-600" : "text-slate-700"}`}>{item.name}</span>
              <button
                disabled={toggle.isPending}
                onClick={() => toggle.mutate(item)}
                className={`min-h-[36px] shrink-0 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50 ${
                  out ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600 hover:border-red-300 hover:text-red-600"
                }`}
              >
                {out ? "Back in stock" : "Sold out"}
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
