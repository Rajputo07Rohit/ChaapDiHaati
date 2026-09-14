import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { MessageCircle, Copy } from "lucide-react";
import { api } from "../api/client";
import { BusinessProfile, SalesOrder } from "../api/types";
import { buildBillMessage, buildWhatsAppShareUrl, normalizeIndianPhone } from "../utils/whatsapp";
import { Button, Modal } from "./ui/Primitives";

const FALLBACK_PROFILE: BusinessProfile = { businessName: "Chaap Di Haati", tagline: "", address: "" };

/** The one place a bill gets turned into a WhatsApp message — reachable from
 * wherever a confirmed order can be viewed (POS right after checkout, and
 * the Orders detail view for any past bill). Always builds the message from
 * the same order object the receipt/print flow uses, so the two can never
 * show different numbers. */
export function ShareBillModal({ order, onClose }: { order: SalesOrder | null; onClose: () => void }) {
  const { data: profile } = useQuery({
    queryKey: ["business-profile"],
    queryFn: () => api.get<BusinessProfile>("/settings/business-profile"),
    enabled: !!order,
    staleTime: 5 * 60 * 1000,
  });

  const [customerName, setCustomerName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");

  // The modal stays mounted with `order` toggling between null and a real
  // order (rather than being remounted each time), so these fields have to
  // be re-synced explicitly whenever a new order is opened — a plain
  // useState initializer only runs once, on this component's first mount.
  useEffect(() => {
    setCustomerName(order?.customer_name ?? "");
    setPhone(order?.customer_phone ?? "");
  }, [order]);

  const message = useMemo(() => {
    if (!order) return "";
    return buildBillMessage(order, profile ?? FALLBACK_PROFILE, customerName);
  }, [order, profile, customerName]);

  if (!order) return null;

  // The phone is optional — leaving it blank still shares fine, WhatsApp
  // just opens its own contact picker instead of a pre-addressed chat. Only
  // block sharing when something was typed but doesn't parse as a number.
  const hasPhoneInput = phone.trim().length > 0;
  const normalized = hasPhoneInput ? normalizeIndianPhone(phone) : null;
  const showPhoneError = hasPhoneInput && !normalized;

  function handleCopy() {
    navigator.clipboard
      .writeText(message)
      .then(() => toast.success("Bill message copied!"))
      .catch(() => toast.error("Could not copy — try selecting the text manually."));
  }

  function handleShare() {
    if (showPhoneError) return;
    const url = buildWhatsAppShareUrl(normalized, message);
    // A named target (instead of "_blank") makes the browser reuse the same
    // tab on every share instead of spawning a fresh one each time — no
    // await before this call, so it still counts as a direct user gesture.
    window.open(url, "whatsapp-share");
    onClose(); // the bill's been handed off to WhatsApp — nothing left to do in this modal
  }

  return (
    <Modal open={!!order} onClose={onClose} title={`Share Bill #${order.order_number}`} wide>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-slate-500">Customer name (optional)</label>
          <input
            type="text"
            placeholder="e.g. Rahul Kumar"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Customer WhatsApp number (optional)</label>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="e.g. 9876543210 — leave blank to pick a contact in WhatsApp"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 ${
              showPhoneError ? "border-rose-400" : "border-slate-300"
            }`}
          />
          {showPhoneError ? (
            <p className="text-xs text-rose-600 mt-1">That doesn't look like a valid 10-digit Indian mobile number — fix it or clear the field.</p>
          ) : (
            <p className="text-xs text-slate-400 mt-1">
              {hasPhoneInput ? "WhatsApp will open a chat with this number directly." : "Leave blank to choose who to send it to inside WhatsApp."}
            </p>
          )}
        </div>

        <div>
          <label className="text-xs font-medium text-slate-500">Message preview</label>
          <pre className="mt-1 w-full max-h-80 overflow-y-auto whitespace-pre-wrap break-words bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs font-sans text-slate-700">
            {message}
          </pre>
        </div>

        <Button className="w-full py-2.5" disabled={showPhoneError} onClick={handleShare}>
          <MessageCircle size={16} /> Share on WhatsApp
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={handleCopy}>
            <Copy size={14} /> Copy Message
          </Button>
        </div>
      </div>
    </Modal>
  );
}
