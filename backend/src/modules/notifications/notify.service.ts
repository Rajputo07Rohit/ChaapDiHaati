import webpush from "web-push";
import { env } from "../../config/env";
import { CustomerProfile, Order, PushSubscription, User } from "../../db/models";
import { formatPaise } from "../../utils/money";
import { nowIso } from "../../utils/ids";

/**
 * Customer order updates that reach them even with the app closed: Web Push
 * (free, any subscribed browser) and WhatsApp (when the Business API is
 * configured). Everything here is best-effort and fire-and-forget — a failed
 * notification is logged, never surfaced to the staff action that caused it.
 */

export type OrderEvent = "ACCEPTED" | "READY_FOR_PICKUP" | "ON_THE_WAY" | "DELIVERED" | "CANCELLED" | "REFUND_COMPLETED";

let vapidReady: boolean | null = null;
function pushEnabled(): boolean {
  if (vapidReady !== null) return vapidReady;
  vapidReady = false;
  if (env.vapidPublicKey && env.vapidPrivateKey) {
    try {
      webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
      vapidReady = true;
    } catch (err) {
      console.error("Web push disabled — invalid VAPID keys:", err);
    }
  }
  return vapidReady;
}

export function pushPublicKey(): string | null {
  return pushEnabled() ? env.vapidPublicKey! : null;
}

export function whatsappEnabled(): boolean {
  return !!env.whatsappToken && !!env.whatsappPhoneNumberId;
}

export async function savePushSubscription(phone: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<void> {
  await PushSubscription.findByIdAndUpdate(
    sub.endpoint,
    { phone, p256dh: sub.keys.p256dh, auth: sub.keys.auth, createdAt: nowIso() },
    { upsert: true }
  );
}

export async function removePushSubscription(phone: string, endpoint: string): Promise<void> {
  await PushSubscription.deleteOne({ _id: endpoint, phone });
}

interface Message {
  title: string;
  body: string;
  url: string;
}

async function sendPush(phone: string, msg: Message): Promise<void> {
  if (!pushEnabled()) return;
  const subs = await PushSubscription.find({ phone });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s._id, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ ...msg, tag: msg.url }),
          { TTL: 60 * 60 }
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        // The browser unsubscribed / the app was uninstalled — forget it.
        if (code === 404 || code === 410) await PushSubscription.deleteOne({ _id: s._id });
        else console.error("Push send failed:", code ?? err);
      }
    })
  );
}

/**
 * Sends the approved "order update" template. Expected template body (3 params):
 *   Hi {{1}}, update on your Desi Chaap Di Hatti order {{2}}: {{3}}
 */
async function sendWhatsApp(phone: string, name: string, orderLabel: string, text: string): Promise<void> {
  if (!whatsappEnabled()) return;
  const profile = await CustomerProfile.findById(phone).select("whatsappOptIn").lean();
  if (profile && profile.whatsappOptIn === false) return;
  const to = phone.replace(/\D/g, "");
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${env.whatsappPhoneNumberId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.whatsappToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: env.whatsappTemplateName,
          language: { code: env.whatsappTemplateLang },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: name.slice(0, 60) || "there" },
                { type: "text", text: orderLabel },
                { type: "text", text: text.replace(/\s+/g, " ").slice(0, 900) },
              ],
            },
          ],
        },
      }),
    });
    if (!res.ok) console.error("WhatsApp send failed:", res.status, await res.text().catch(() => ""));
  } catch (err) {
    console.error("WhatsApp send failed:", err);
  }
}

function orderLink(orderId: string): string {
  return `/order/${orderId}`;
}

async function buildMessage(orderId: string, event: OrderEvent): Promise<{ phone: string; name: string; label: string; msg: Message } | null> {
  const o = await Order.findById(orderId).lean();
  // Only customer self-orders (placed in the app, never by staff) get notifications.
  if (!o || !o.customerPhone || o.createdBy) return null;
  const n = `#${o.orderNumber}`;
  let title = "";
  let body = "";
  switch (event) {
    case "ACCEPTED":
      title = `Order ${n} accepted 👍`;
      body = o.prepTimeMinutes ? `The kitchen is on it — ready in about ${o.prepTimeMinutes} min.` : "The kitchen is on it.";
      break;
    case "READY_FOR_PICKUP":
      title = `Order ${n} is ready!`;
      body = o.orderType === "DINE_IN" ? "Your food is ready — it's coming to your table." : "Please collect it at the counter.";
      break;
    case "ON_THE_WAY": {
      const rider = o.assignedRiderId ? await User.findById(o.assignedRiderId).select("fullName phone").lean() : null;
      title = `Order ${n} is on the way 🛵`;
      body = rider ? `${rider.fullName.split(" ")[0]} is bringing it${rider.phone ? ` (${rider.phone})` : ""}.` : "Your food has left the restaurant.";
      if (o.paymentStatus !== "PAID") body += ` Please keep ${formatPaise(o.netTotalPaise)} ready.`;
      break;
    }
    case "DELIVERED":
      title = `Order ${n} delivered`;
      body = "Enjoy your meal! Tap to rate your order.";
      break;
    case "CANCELLED":
      title = `Order ${n} was cancelled`;
      body = o.cancelReason ?? "The restaurant couldn't take your order.";
      if (o.refundStatus) {
        body += ` A full refund of ${formatPaise(o.refundAmountPaise ?? o.netTotalPaise)} has been started — it usually reaches your UPI account in 3–5 working days.`;
      }
      break;
    case "REFUND_COMPLETED":
      title = `Refund for order ${n} completed`;
      body = `${formatPaise(o.refundAmountPaise ?? o.netTotalPaise)} has been sent back to your UPI account.`;
      break;
  }
  return { phone: o.customerPhone, name: o.customerName ?? "", label: n, msg: { title, body, url: orderLink(o._id) } };
}

/** Fire-and-forget: tell the customer about a change to their order. */
export function notifyOrderEvent(orderId: string, event: OrderEvent): void {
  if (!pushEnabled() && !whatsappEnabled()) return;
  void (async () => {
    const built = await buildMessage(orderId, event);
    if (!built) return;
    await Promise.all([
      sendPush(built.phone, built.msg),
      sendWhatsApp(built.phone, built.name, built.label, `${built.msg.title}. ${built.msg.body}`),
    ]);
  })().catch((err) => console.error(`Notification ${event} for ${orderId} failed:`, err));
}

/** Fire-and-forget: a payment that couldn't become an order and was refunded. */
export function notifyCheckoutRefund(phone: string, name: string, amountPaise: number, reason: string): void {
  const msg: Message = {
    title: "Payment refunded",
    body: `We couldn't place your order (${reason}). Your ${formatPaise(amountPaise)} is being refunded to your UPI account — usually 3–5 working days.`,
    url: "/orders",
  };
  void Promise.all([sendPush(phone, msg), sendWhatsApp(phone, name, "payment", `${msg.title}. ${msg.body}`)]).catch((err) =>
    console.error("Checkout refund notification failed:", err)
  );
}
