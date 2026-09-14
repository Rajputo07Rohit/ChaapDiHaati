import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Minus, Trash2, X, Percent, Tag, MessageCircle, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "../api/client";
import { DiscountType, MenuCategory, OrderType, PaymentMethod, PriceType, SalesOrder } from "../api/types";
import { formatPaise, rupeesToPaise } from "../utils/money";
import { printReceipt } from "../utils/receipt";
import { Badge, Button, Input, Modal, PageHeader, Select } from "../components/ui/Primitives";
import { ShareBillModal } from "../components/ShareBillModal";

interface CartLine {
  key: string;
  menuItemId: string;
  name: string;
  categoryName: string;
  priceType: PriceType;
  priceLabel: string; // human label for priceType, e.g. "Half" or "5 pc" for momo
  unitPricePaise: number;
  quantity: number;
  specialInstructions?: string;
  discountType: DiscountType;
  discountValueInput: string; // FLAT: rupees as typed; PERCENTAGE: raw 0-100 number
}

const ORDER_TYPES: { value: OrderType; label: string }[] = [
  { value: "DINE_IN", label: "Dine-in" },
  { value: "TAKEAWAY", label: "Takeaway" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "ONLINE", label: "Online" },
];

/** The categories a running "10% off" promotion applies to — Rolls, Breads,
 * and Extras are deliberately excluded per the owner's pricing policy. Quick
 * Discount only ever touches lines in these categories; every other line in
 * the cart is left exactly as it was. */
const QUICK_DISCOUNT_CATEGORIES = ["Soya Tandoori (Chaap)", "Paneer Tandoori", "Mushroom Tandoori", "Momo"];
const QUICK_DISCOUNT_PERCENT = "10";

/** Mirrors the backend's resolveDiscountAmount so the POS preview matches what will actually be charged. */
function resolveDiscount(basePaise: number, type: DiscountType, valueInput: string): number {
  const raw = parseFloat(valueInput);
  if (!raw || raw <= 0) return 0;
  const amount = type === "PERCENTAGE" ? Math.round((basePaise * Math.min(raw, 100)) / 100) : Math.round(rupeesToPaise(raw));
  return Math.min(Math.max(amount, 0), basePaise);
}

export function POS() {
  const queryClient = useQueryClient();
  const { data: menuData } = useQuery({ queryKey: ["menu"], queryFn: () => api.get<{ categories: MenuCategory[] }>("/menu") });
  const { data: pmData } = useQuery({ queryKey: ["payment-methods"], queryFn: () => api.get<{ methods: PaymentMethod[] }>("/payment-methods") });

  const categories = (menuData?.categories ?? []).filter((c) => c.name !== "System" && c.items.length > 0);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const catToShow = activeCat ?? categories[0]?.id ?? null;

  const [cart, setCart] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [orderDiscountType, setOrderDiscountType] = useState<DiscountType>("FLAT");
  const [orderDiscountInput, setOrderDiscountInput] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [notes, setNotes] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountLineOpen, setDiscountLineOpen] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [completedOrder, setCompletedOrder] = useState<SalesOrder | null>(null);
  const [sharingOrder, setSharingOrder] = useState<SalesOrder | null>(null);
  const [cancelCartOpen, setCancelCartOpen] = useState(false);

  const lineTotals = cart.map((l) => {
    const lineSubtotal = l.unitPricePaise * l.quantity;
    const itemDiscount = resolveDiscount(lineSubtotal, l.discountType, l.discountValueInput);
    return { ...l, lineSubtotal, itemDiscount, lineNet: lineSubtotal - itemDiscount };
  });
  const subtotal = lineTotals.reduce((s, l) => s + l.lineSubtotal, 0);
  const itemDiscountTotal = lineTotals.reduce((s, l) => s + l.itemDiscount, 0);
  const baseForOrderDiscount = subtotal - itemDiscountTotal;
  const orderDiscountPaise = resolveDiscount(baseForOrderDiscount, orderDiscountType, orderDiscountInput);
  const netTotal = baseForOrderDiscount - orderDiscountPaise;
  const totalDiscount = itemDiscountTotal + orderDiscountPaise;

  function addToCart(menuItemId: string, name: string, categoryName: string, priceType: PriceType, priceLabel: string, unitPricePaise: number) {
    setCompletedOrder(null); // tapping an item means a fresh order — drop the previous one's confirmation screen
    setCart((prev) => {
      const key = `${menuItemId}:${priceType}`;
      const existing = prev.find((l) => l.key === key);
      if (existing) return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...prev,
        { key, menuItemId, name, categoryName, priceType, priceLabel, unitPricePaise, quantity: 1, discountType: "FLAT", discountValueInput: "" },
      ];
    });
  }

  /** One tap applies the running promotion to every eligible line already in
   * the cart (and nothing else) — no need to open each line's discount editor
   * one by one when half the order qualifies. */
  function applyQuickDiscount() {
    setCart((prev) =>
      prev.map((l) =>
        QUICK_DISCOUNT_CATEGORIES.includes(l.categoryName)
          ? { ...l, discountType: "PERCENTAGE" as DiscountType, discountValueInput: QUICK_DISCOUNT_PERCENT }
          : l
      )
    );
    const eligibleCount = cart.filter((l) => QUICK_DISCOUNT_CATEGORIES.includes(l.categoryName)).length;
    if (eligibleCount === 0) {
      toast.error("No items from the discount-eligible categories are in the cart.");
    } else {
      toast.success(`${QUICK_DISCOUNT_PERCENT}% off applied to ${eligibleCount} eligible item${eligibleCount > 1 ? "s" : ""}`);
    }
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) => prev.flatMap((l) => (l.key === key ? (l.quantity + delta <= 0 ? [] : [{ ...l, quantity: l.quantity + delta }]) : [l])));
  }

  function updateLineDiscount(key: string, patch: Partial<Pick<CartLine, "discountType" | "discountValueInput">>) {
    setCart((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function resetCart() {
    setCart([]);
    setOrderDiscountInput("");
    setDiscountReason("");
    setNotes("");
    setDiscountOpen(false);
    setDiscountLineOpen(null);
    setCustomerName("");
    setCustomerPhone("");
  }

  function buildOrderPayload() {
    return {
      orderType,
      customerName: customerName || undefined,
      customerPhone: customerPhone || undefined,
      items: cart.map((l) => ({
        menuItemId: l.menuItemId,
        priceType: l.priceType,
        quantity: l.quantity,
        specialInstructions: l.specialInstructions,
        discountType: l.discountType,
        discountValue: l.discountType === "PERCENTAGE" ? parseFloat(l.discountValueInput) || 0 : rupeesToPaise(parseFloat(l.discountValueInput) || 0),
      })),
      discountType: orderDiscountType,
      discountValue: orderDiscountType === "PERCENTAGE" ? parseFloat(orderDiscountInput) || 0 : rupeesToPaise(parseFloat(orderDiscountInput) || 0),
      discountReason: totalDiscount > 0 ? discountReason : undefined,
      notes: notes || undefined,
    };
  }

  const createAndCompleteMutation = useMutation({
    mutationFn: async (vars: { payments: { paymentMethodId: string; amountPaise: number }[] }) => {
      const created = await api.post<{ order: SalesOrder }>("/orders", buildOrderPayload());
      return api.post<{ order: SalesOrder }>(`/orders/${created.order.id}/complete`, { payments: vars.payments });
    },
    onSuccess: (res) => {
      toast.success(`Order #${res.order.order_number} completed`);
      printReceipt(res.order);
      setCompletedOrder(res.order);
      resetCart();
      setPayOpen(false);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["kitchen"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.message : "Could not complete order");
    },
  });

  const currentCategory = categories.find((c) => c.id === catToShow);
  const extrasCategory = categories.find((c) => c.name === "Extras");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px] gap-6 h-full">
      <div className="min-w-0">
        <PageHeader title="POS / New Order" />
        <div className="flex gap-2 overflow-x-auto pb-3 mb-4 border-b border-slate-200">
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCat(cat.id)}
              className={`px-3.5 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-transform duration-75 active:scale-95 [touch-action:manipulation] [-webkit-tap-highlight-color:transparent] select-none ${
                catToShow === cat.id ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200 active:bg-slate-300"
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {currentCategory?.items.map((item) => {
            const half = item.prices.find((p) => p.price_type === "HALF");
            const full = item.prices.find((p) => p.price_type === "FULL");
            const single = item.prices.find((p) => p.price_type === "SINGLE");
            const unavailable = item.status !== "ACTIVE";
            return (
              <div key={item.id} className={`bg-white border border-slate-200 rounded-lg p-3 ${unavailable ? "opacity-50" : ""}`}>
                <div className="font-medium text-sm text-slate-800 mb-2">{item.name}</div>
                {unavailable && <Badge tone="red">Unavailable</Badge>}
                {!unavailable && (
                  <div className="space-y-1.5">
                    {half && (
                      <button
                        onClick={() => addToCart(item.id, item.name, currentCategory!.name, "HALF", item.half_label, half.price_paise)}
                        className="tap-btn w-full flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5"
                      >
                        <span className="text-slate-500">{item.half_label}</span>
                        <span className="font-semibold">{formatPaise(half.price_paise)}</span>
                      </button>
                    )}
                    {full && (
                      <button
                        onClick={() => addToCart(item.id, item.name, currentCategory!.name, "FULL", item.full_label, full.price_paise)}
                        className="tap-btn w-full flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5"
                      >
                        <span className="text-slate-500">{item.full_label}</span>
                        <span className="font-semibold">{formatPaise(full.price_paise)}</span>
                      </button>
                    )}
                    {single && (
                      <button
                        onClick={() => addToCart(item.id, item.name, currentCategory!.name, "SINGLE", "Add", single.price_paise)}
                        className="tap-btn w-full flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1.5"
                      >
                        <span className="text-slate-500">Add</span>
                        <span className="font-semibold">{formatPaise(single.price_paise)}</span>
                      </button>
                    )}
                    {!half && !full && !single && <p className="text-xs text-amber-600">Price not configured</p>}
                  </div>
                )}
              </div>
            );
          })}
          {currentCategory && currentCategory.items.length === 0 && <p className="text-sm text-slate-400 col-span-full">No items in this category yet.</p>}
        </div>
      </div>

      {/* Cart */}
      <div className="bg-white border border-slate-200 rounded-xl flex flex-col h-[70vh] lg:h-[calc(100vh-4rem)] lg:sticky lg:top-4">
        {completedOrder ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center gap-4">
            <CheckCircle2 size={40} className="text-emerald-500" />
            <div className="text-sm text-slate-500">Order #{completedOrder.order_number} completed</div>
            <div className="w-full max-w-xs flex items-center justify-between border-t border-b border-slate-100 py-3">
              <span className="font-semibold text-slate-800">Grand Total</span>
              <span className="font-bold text-xl tabular-nums">{formatPaise(completedOrder.net_total_paise)}</span>
            </div>
            <div className="w-full max-w-xs space-y-2">
              <Button className="w-full py-2.5" onClick={() => setSharingOrder(completedOrder)}>
                <MessageCircle size={16} /> Save Bill & Share on WhatsApp
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => printReceipt(completedOrder)}>
                  Print
                </Button>
                <Button variant="danger" onClick={() => setCompletedOrder(null)}>
                  Clear
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
        <div className="p-3 border-b border-slate-100">
          <div className="grid grid-cols-4 gap-1.5">
            {ORDER_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setOrderType(t.value)}
                className={`tap-btn rounded-lg text-xs font-medium py-2 px-1 text-center min-w-0 truncate ${
                  orderType === t.value ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {extrasCategory && extrasCategory.items.length > 0 && (
          <div className="px-3 py-2 border-b border-slate-100 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-slate-400 shrink-0">Quick add:</span>
            {extrasCategory.items.map((item) => {
              const price = item.prices.find((p) => p.price_type === "SINGLE") ?? item.prices[0];
              if (!price) return null;
              return (
                <button
                  key={item.id}
                  onClick={() => addToCart(item.id, item.name, extrasCategory.name, price.price_type, "Add", price.price_paise)}
                  className="tap-btn text-[11px] font-medium px-2 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-slate-200"
                >
                  + {item.name} ({formatPaise(price.price_paise)})
                </button>
              );
            })}
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {cart.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Cart is empty. Tap items to add.</p>}
          {lineTotals.map((line) => (
            <div key={line.key} className="border-b border-slate-50 pb-2">
              <div className="flex items-center gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-800 truncate">
                    {line.name} <span className="text-slate-400 text-xs">({line.priceLabel})</span>
                  </div>
                  <div className="text-xs text-slate-400">{formatPaise(line.unitPricePaise)} each</div>
                </div>
                <button onClick={() => updateQty(line.key, -1)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 active:bg-slate-300 active:scale-90 transition-transform duration-75 shrink-0 [touch-action:manipulation] select-none">
                  <Minus size={12} />
                </button>
                <span className="w-5 text-center tabular-nums shrink-0">{line.quantity}</span>
                <button onClick={() => updateQty(line.key, 1)} className="w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 active:bg-slate-300 active:scale-90 transition-transform duration-75 shrink-0 [touch-action:manipulation] select-none">
                  <Plus size={12} />
                </button>
                <span className="w-16 text-right font-medium tabular-nums shrink-0">{formatPaise(line.lineNet)}</span>
                <button onClick={() => removeLine(line.key)} className="text-slate-300 hover:text-rose-500 shrink-0">
                  <Trash2 size={14} />
                </button>
              </div>
              {discountLineOpen === line.key ? (
                <div className="flex items-center gap-1.5 mt-1.5 pl-0.5">
                  <button
                    title="Flat ₹ off this item"
                    onClick={() => updateLineDiscount(line.key, { discountType: "FLAT" })}
                    className={`text-[11px] px-1.5 py-0.5 rounded ${line.discountType === "FLAT" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}
                  >
                    ₹
                  </button>
                  <button
                    title="Percent off this item"
                    onClick={() => updateLineDiscount(line.key, { discountType: "PERCENTAGE" })}
                    className={`text-[11px] px-1.5 py-0.5 rounded ${line.discountType === "PERCENTAGE" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-500"}`}
                  >
                    <Percent size={10} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    autoFocus
                    placeholder="Item discount"
                    value={line.discountValueInput}
                    onChange={(e) => updateLineDiscount(line.key, { discountValueInput: e.target.value })}
                    className="w-24 text-xs border border-slate-200 rounded px-1.5 py-0.5"
                  />
                  {line.itemDiscount > 0 && <span className="text-[11px] text-rose-600">-{formatPaise(line.itemDiscount)}</span>}
                  {line.discountValueInput && (
                    <button
                      title="Remove this discount"
                      onClick={() => updateLineDiscount(line.key, { discountValueInput: "" })}
                      className="text-slate-300 hover:text-rose-500"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <button onClick={() => setDiscountLineOpen(null)} className="text-[11px] text-slate-400 ml-auto">
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 mt-1 pl-0.5">
                  <button onClick={() => setDiscountLineOpen(line.key)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600">
                    <Tag size={10} />
                    {line.itemDiscount > 0 ? <span className="text-rose-600 font-medium">-{formatPaise(line.itemDiscount)} applied</span> : "Add discount"}
                  </button>
                  {line.itemDiscount > 0 && (
                    <button
                      title="Remove this discount"
                      onClick={() => updateLineDiscount(line.key, { discountValueInput: "" })}
                      className="text-slate-300 hover:text-rose-500"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-slate-100 space-y-2">
          {cart.length > 0 && (
            <button
              onClick={applyQuickDiscount}
              title={`Applies only to: ${QUICK_DISCOUNT_CATEGORIES.join(", ")}`}
              className="tap-btn w-full flex items-center justify-center gap-1.5 text-xs font-medium rounded-lg py-2 border border-dashed border-brand-300 text-brand-700 bg-brand-50 hover:bg-brand-100"
            >
              <Percent size={12} /> Apply {QUICK_DISCOUNT_PERCENT}% Off — Chaap, Momo, Paneer & Mushroom Tandoori
            </button>
          )}
          {discountOpen ? (
            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-500">Overall order discount</label>
                <div className="flex items-center gap-2">
                  {orderDiscountPaise > 0 && (
                    <button
                      title="Remove this discount"
                      onClick={() => setOrderDiscountInput("")}
                      className="text-[11px] text-rose-500 hover:text-rose-600 font-medium"
                    >
                      Remove
                    </button>
                  )}
                  <button onClick={() => setDiscountOpen(false)} className="text-[11px] text-slate-400">
                    Done
                  </button>
                </div>
              </div>
              <div className="flex gap-1.5 mt-1">
                <button
                  onClick={() => setOrderDiscountType("FLAT")}
                  className={`text-xs px-2.5 py-2 rounded-lg ${orderDiscountType === "FLAT" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  ₹
                </button>
                <button
                  onClick={() => setOrderDiscountType("PERCENTAGE")}
                  className={`text-xs px-2.5 py-2 rounded-lg flex items-center ${orderDiscountType === "PERCENTAGE" ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  <Percent size={12} />
                </button>
                <Input
                  autoFocus
                  placeholder={orderDiscountType === "PERCENTAGE" ? "% off" : "₹ off"}
                  value={orderDiscountInput}
                  onChange={(e) => setOrderDiscountInput(e.target.value)}
                  className="flex-1"
                  type="number"
                  min={0}
                />
              </div>
              <Input
                placeholder="Discount reason (optional)"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                className="w-full mt-1.5"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button onClick={() => setDiscountOpen(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600">
                <Tag size={11} />
                {orderDiscountPaise > 0 ? (
                  <span className="text-rose-600 font-medium">-{formatPaise(orderDiscountPaise)} order discount applied</span>
                ) : (
                  "Add order discount"
                )}
              </button>
              {orderDiscountPaise > 0 && (
                <button title="Remove this discount" onClick={() => setOrderDiscountInput("")} className="text-slate-300 hover:text-rose-500">
                  <X size={12} />
                </button>
              )}
            </div>
          )}
          <Input placeholder="Notes / special instructions" value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full" />
          <div className="flex justify-between text-sm pt-1">
            <span className="text-slate-500">Subtotal</span>
            <span className="tabular-nums">{formatPaise(subtotal)}</span>
          </div>
          {itemDiscountTotal > 0 && (
            <div className="flex justify-between text-sm text-rose-600">
              <span>Item discounts</span>
              <span className="tabular-nums">-{formatPaise(itemDiscountTotal)}</span>
            </div>
          )}
          {orderDiscountPaise > 0 && (
            <div className="flex justify-between text-sm text-rose-600">
              <span>Order discount ({orderDiscountType === "PERCENTAGE" ? `${orderDiscountInput}%` : "flat"})</span>
              <span className="tabular-nums">-{formatPaise(orderDiscountPaise)}</span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-base">
            <span>Total</span>
            <span className="tabular-nums">{formatPaise(netTotal)}</span>
          </div>
          <Button className="w-full py-2.5" disabled={cart.length === 0} onClick={() => setPayOpen(true)}>
            Charge & Complete
          </Button>
          {cart.length > 0 && (
            <button onClick={() => setCancelCartOpen(true)} className="w-full text-center text-xs text-rose-500 hover:text-rose-600 pt-1">
              Cancel Order
            </button>
          )}
        </div>
          </>
        )}
      </div>

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        netTotal={netTotal}
        methods={pmData?.methods ?? []}
        submitting={createAndCompleteMutation.isPending}
        onConfirm={(payments) => createAndCompleteMutation.mutate({ payments })}
        customerName={customerName}
        setCustomerName={setCustomerName}
        customerPhone={customerPhone}
        setCustomerPhone={setCustomerPhone}
      />
      <ShareBillModal order={sharingOrder} onClose={() => setSharingOrder(null)} />

      <Modal open={cancelCartOpen} onClose={() => setCancelCartOpen(false)} title="Cancel this order?">
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            This clears everything in the cart. Nothing has been charged yet, so there's nothing to undo on the server — it just resets this
            screen.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setCancelCartOpen(false)}>
              Keep Order
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                resetCart();
                setCancelCartOpen(false);
                toast.success("Order cancelled");
              }}
            >
              Cancel Order
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PaymentModal({
  open,
  onClose,
  netTotal,
  methods,
  onConfirm,
  submitting,
  customerName,
  setCustomerName,
  customerPhone,
  setCustomerPhone,
}: {
  open: boolean;
  onClose: () => void;
  netTotal: number;
  methods: PaymentMethod[];
  onConfirm: (payments: { paymentMethodId: string; amountPaise: number }[]) => void;
  submitting: boolean;
  customerName: string;
  setCustomerName: (v: string) => void;
  customerPhone: string;
  setCustomerPhone: (v: string) => void;
}) {
  const [lines, setLines] = useState<{ paymentMethodId: string; amountRupees: string }[]>([]);

  useEffect(() => {
    if (open && methods.length > 0) {
      setLines([{ paymentMethodId: methods[0].id, amountRupees: (netTotal / 100).toString() }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, methods]);

  if (!open) return null;

  const total = lines.reduce((s, l) => s + rupeesToPaise(parseFloat(l.amountRupees) || 0), 0);
  const balanced = total === netTotal;

  return (
    <Modal open={open} onClose={onClose} title="Collect Payment">
      <div className="space-y-3">
        <div className="text-sm text-slate-500">
          Order total: <span className="font-semibold text-slate-900">{formatPaise(netTotal)}</span>
        </div>
        <div>
          <label className="text-xs text-slate-500">Customer details (optional — lets you share the bill on WhatsApp after)</label>
          <div className="flex gap-1.5 mt-1">
            <Input placeholder="Name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="flex-1" />
            <Input
              placeholder="WhatsApp number"
              type="tel"
              inputMode="numeric"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="flex-1"
            />
          </div>
        </div>
        {lines.map((line, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Select
              value={line.paymentMethodId}
              onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, paymentMethodId: e.target.value } : l)))}
              className="flex-1"
            >
              {methods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              className="w-28"
              value={line.amountRupees}
              onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, amountRupees: e.target.value } : l)))}
            />
            {lines.length > 1 && (
              <button onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-rose-500">
                <X size={16} />
              </button>
            )}
          </div>
        ))}
        <button
          className="text-xs text-brand-600 font-medium"
          onClick={() => setLines((prev) => [...prev, { paymentMethodId: methods[0]?.id ?? "", amountRupees: "" }])}
        >
          + Split payment
        </button>
        <div className={`text-sm ${balanced ? "text-emerald-600" : "text-rose-600"}`}>
          Entered: {formatPaise(total)} {balanced ? "✓ matches order total" : `— must equal ${formatPaise(netTotal)}`}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={submitting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!balanced || submitting}
            onClick={() =>
              onConfirm(lines.map((l) => ({ paymentMethodId: l.paymentMethodId, amountPaise: rupeesToPaise(parseFloat(l.amountRupees) || 0) })))
            }
          >
            {submitting ? "Processing…" : "Confirm Payment"}
          </Button>
        </div>
        <p className="text-[11px] text-slate-400 text-center">Cancelling here charges nothing — no order is created until payment is confirmed.</p>
      </div>
    </Modal>
  );
}
