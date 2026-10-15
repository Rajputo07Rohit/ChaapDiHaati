import { env } from "../../config/env";
import { AppError } from "../../utils/errors";

const API_VERSION = "2023-08-01";

// Only UPI (QR + UPI apps) is offered at checkout — no cards, netbanking,
// wallets, EMI or pay-later. Set per order so it can't be widened from the browser.
const ALLOWED_PAYMENT_METHODS = "upi";

export interface CashfreeOrder {
  cf_order_id?: string | number;
  order_id: string;
  order_amount: number;
  order_currency: string;
  order_meta?: { payment_methods?: string | null };
  /** ACTIVE (awaiting payment) | PAID | EXPIRED | TERMINATED … */
  order_status: string;
  payment_session_id?: string;
  customer_details?: { customer_id?: string; customer_phone?: string };
}

export function isCashfreeConfigured(): boolean {
  return !!env.cashfreeAppId && !!env.cashfreeSecretKey;
}

function baseUrl(): string {
  return env.cashfreeEnv === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
}

async function cashfree<T>(path: string, init: { method: "GET" | "POST" | "PATCH"; body?: unknown }): Promise<T> {
  if (!isCashfreeConfigured()) {
    throw new AppError(500, "Online payment isn't configured yet. Please choose Cash on Delivery.", "CASHFREE_NOT_CONFIGURED", "Missing CASHFREE_APP_ID/CASHFREE_SECRET_KEY env vars.");
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, {
      method: init.method,
      headers: {
        "x-client-id": env.cashfreeAppId!,
        "x-client-secret": env.cashfreeSecretKey!,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new AppError(502, "Could not reach the payment service. Please try again.", "CASHFREE_UNREACHABLE");
  }
  const body = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!res.ok || !body) {
    throw new AppError(502, "Could not start the payment. Please try again or choose Cash on Delivery.", "CASHFREE_ERROR", body?.message ?? `HTTP ${res.status}`);
  }
  return body;
}

/** Cashfree wants a plain 10-digit mobile number for the customer. */
export function tenDigitPhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

// Cashfree refuses an order expiry under 15 minutes, so the gateway-side expiry is
// only a cleanup backstop; the real 5-minute payment window is enforced by us
// (the app's countdown, then terminateCashfreeOrder).
const GATEWAY_EXPIRY_MINUTES = 16;

export async function createCashfreeOrder(input: { orderId: string; amountPaise: number; phone: string; name?: string | null }): Promise<CashfreeOrder> {
  const phone = tenDigitPhone(input.phone);
  return cashfree<CashfreeOrder>("/orders", {
    method: "POST",
    body: {
      order_id: input.orderId,
      order_amount: Number((input.amountPaise / 100).toFixed(2)),
      order_currency: "INR",
      order_meta: { payment_methods: ALLOWED_PAYMENT_METHODS },
      order_expiry_time: new Date(Date.now() + GATEWAY_EXPIRY_MINUTES * 60_000).toISOString(),
      customer_details: {
        customer_id: `cust_${phone}`,
        customer_phone: phone,
        ...(input.name ? { customer_name: input.name } : {}),
      },
    },
  });
}

export async function fetchCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  return cashfree<CashfreeOrder>(`/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
}

/** Closes an unpaid order so it can no longer be paid. Cashfree rejects this if the order is already paid. */
export async function terminateCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  return cashfree<CashfreeOrder>(`/orders/${encodeURIComponent(orderId)}`, { method: "PATCH", body: { order_status: "TERMINATED" } });
}
