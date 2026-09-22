import { ButtonHTMLAttributes, HTMLAttributes, ReactNode, useEffect, useRef, useState } from "react";
import { MoreVertical } from "lucide-react";

export function Card({ className = "", children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`bg-white border border-slate-200 rounded-xl shadow-sm ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "positive" | "negative" | "warning";
}) {
  const toneClass =
    tone === "positive" ? "text-emerald-600" : tone === "negative" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : "text-slate-900";
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
    </Card>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md" }) {
  const base =
    "inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-[transform,background-color] duration-75 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.96] [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] select-none";
  const sizeClass = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const variantClass = {
    primary: "bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800",
    secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200 active:bg-slate-300",
    danger: "bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800",
    ghost: "text-slate-600 hover:bg-slate-100 active:bg-slate-200",
  }[variant];
  return <button className={`${base} ${sizeClass} ${variantClass} ${className}`} {...rest} />;
}

export function Badge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "green" | "red" | "yellow" | "blue" | "gray" }) {
  const toneClass = {
    default: "bg-slate-100 text-slate-700",
    green: "bg-emerald-100 text-emerald-700",
    red: "bg-rose-100 text-rose-700",
    yellow: "bg-amber-100 text-amber-700",
    blue: "bg-blue-100 text-blue-700",
    gray: "bg-slate-100 text-slate-500",
  }[tone];
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${toneClass}`}>{children}</span>;
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center py-12 text-slate-400">
      <p className="font-medium text-slate-500">{title}</p>
      {description && <p className="text-sm mt-1">{description}</p>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-slate-200 rounded ${className}`} />;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="text-sm text-slate-500 mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent bg-white ${props.className ?? ""}`}
    />
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div
        className={`bg-white rounded-xl shadow-xl w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function StockBadge({ status }: { status: string }) {
  const map: Record<string, { tone: "red" | "yellow" | "green" | "default"; label: string }> = {
    OUT_OF_STOCK: { tone: "red", label: "Out of stock" },
    CRITICAL: { tone: "red", label: "Critical" },
    LOW: { tone: "yellow", label: "Low" },
    HEALTHY: { tone: "green", label: "Healthy" },
  };
  const m = map[status] ?? { tone: "default" as const, label: status };
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function OrderStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "green" | "red" | "yellow" | "blue" | "gray"> = {
    DRAFT: "gray",
    CONFIRMED: "blue",
    PREPARING: "yellow",
    READY: "yellow",
    OUT_FOR_DELIVERY: "blue",
    DELIVERED: "green",
    COMPLETED: "green",
    CANCELLED: "red",
    REFUNDED: "red",
  };
  return <Badge tone={map[status] ?? "default"}>{status.replace(/_/g, " ")}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "green" | "red" | "yellow" | "blue" | "gray"> = {
    UNPAID: "red",
    PARTIAL: "yellow",
    PAID: "green",
    REFUNDED: "gray",
  };
  return <Badge tone={map[status] ?? "default"}>{status}</Badge>;
}

export function KitchenStatusBadge({ status }: { status: "PENDING" | "READY" }) {
  return <Badge tone={status === "READY" ? "green" : "yellow"}>{status === "READY" ? "Ready" : "Preparing"}</Badge>;
}

export interface ActionMenuItem {
  label: string;
  onClick: () => void;
  tone?: "default" | "danger";
  hidden?: boolean;
}

/** A row's secondary actions folded into one "⋮" menu instead of a wall of
 * buttons — the primary action (e.g. "+ Add Stock") stays a direct button;
 * everything else (Adjust, Edit, Delete…) lives here, one click away. */
export function ActionMenu({ items }: { items: ActionMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (visible.length === 0) return null;

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 active:bg-slate-200"
        aria-label="More actions"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
          {visible.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${item.tone === "danger" ? "text-rose-600" : "text-slate-700"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
