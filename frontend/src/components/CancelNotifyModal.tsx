import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { api } from "../api/client";
import { BusinessProfile, SalesOrder } from "../api/types";
import { buildCancelMessage, buildWhatsAppShareUrl, normalizeIndianPhone } from "../utils/whatsapp";
import { Button, Input, Modal } from "./ui/Primitives";

const FALLBACK_PROFILE: BusinessProfile = { businessName: "Chaap Di Haati", tagline: "", address: "" };

export interface CancelNotice {
  order: SalesOrder;
  reason: string;
  wasDenied: boolean;
}

/** Shown right after staff cancel/deny an order: one tap opens WhatsApp with
 * the customer's number and an editable apology message already filled in.
 * It's a click-to-chat link (no WhatsApp Business API), so staff still press
 * Send inside WhatsApp — the browser won't allow it to auto-send. */
export function CancelNotifyModal({ notice, onClose }: { notice: CancelNotice | null; onClose: () => void }) {
  const { data: profile } = useQuery({
    queryKey: ["business-profile"],
    queryFn: () => api.get<BusinessProfile>("/settings/business-profile"),
    enabled: !!notice,
    staleTime: 5 * 60 * 1000,
  });
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!notice) return;
    setPhone(notice.order.customer_phone ?? "");
    setMessage(buildCancelMessage(notice.order, profile ?? FALLBACK_PROFILE, notice.reason, notice.wasDenied));
  }, [notice, profile]);

  if (!notice) return null;
  const normalized = normalizeIndianPhone(phone);
  const showError = phone.trim().length > 0 && !normalized;

  return (
    <Modal open onClose={onClose} title={`Order #${notice.order.order_number} ${notice.wasDenied ? "denied" : "cancelled"}`}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Let the customer know on WhatsApp so they aren't left waiting.</p>
        <div>
          <label className="text-xs font-medium text-slate-500">Customer WhatsApp number</label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile number" className="w-full" />
          {showError && <p className="mt-1 text-xs text-rose-600">That doesn't look like a valid Indian mobile number.</p>}
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Message (you can edit)</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={9}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Skip
          </Button>
          <Button
            className="flex-1"
            disabled={showError || !message.trim()}
            onClick={() => {
              window.open(buildWhatsAppShareUrl(normalized, message), "_blank", "noopener,noreferrer");
              onClose();
            }}
          >
            <MessageCircle size={16} /> Send on WhatsApp
          </Button>
        </div>
      </div>
    </Modal>
  );
}
