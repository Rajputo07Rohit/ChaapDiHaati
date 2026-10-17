import crypto from "crypto";
import { Order } from "../../db/models";
import { nowIso } from "../../utils/ids";
import { recordAudit } from "../../utils/audit";
import { AppError, ConflictError, NotFoundError } from "../../utils/errors";
import { createCashfreeRefund, fetchCashfreeRefund, isCashfreeConfigured } from "./cashfree.service";
import { notifyOrderEvent } from "../notifications/notify.service";

/** Retry a failed refund call this many times (once per sweep, ≥2 min apart) before it needs a human. */
const MAX_AUTO_ATTEMPTS = 6;
const RETRY_GAP_MS = 2 * 60_000;

/** Deterministic per order (≤40 chars, Cashfree's limit) so a retry can never refund twice. */
export function refundIdFor(key: string): string {
  return `rf_${crypto.createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function mapStatus(cfStatus: string): "PENDING" | "SUCCESS" | "FAILED" {
  if (cfStatus === "SUCCESS") return "SUCCESS";
  if (cfStatus === "CANCELLED") return "FAILED";
  return "PENDING"; // PENDING, ONHOLD
}

function errorText(err: unknown): string {
  if (err instanceof AppError) return `${err.publicMessage}${err.message && err.message !== err.publicMessage ? ` (${err.message})` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

/**
 * Marks a cancelled, gateway-paid order as needing a refund. Call inside the
 * cancel transaction (it only mutates the doc); `startGatewayRefund` then
 * talks to Cashfree after the commit.
 */
export function flagGatewayRefund(doc: { paymentRef?: string | null; paymentStatus: string; netTotalPaise: number; _id: string; refundStatus: string | null; refundId: string | null; refundAmountPaise: number | null; refundInitiatedAt: string | null; refundUpdatedAt: string | null }): boolean {
  if (!doc.paymentRef || doc.paymentStatus !== "PAID" || doc.refundStatus) return false;
  const now = nowIso();
  doc.refundStatus = "PENDING";
  doc.refundId = refundIdFor(doc._id);
  doc.refundAmountPaise = doc.netTotalPaise;
  doc.refundInitiatedAt = now;
  doc.refundUpdatedAt = now;
  return true;
}

/** Asks Cashfree to refund an order flagged by flagGatewayRefund. Never throws. */
export async function startGatewayRefund(orderId: string, userId: string | null = null): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order || !order.paymentRef || !order.refundId || order.refundStatus === "SUCCESS") return;
  const now = nowIso();
  try {
    const refund = await createCashfreeRefund({
      orderId: order.paymentRef,
      refundId: order.refundId,
      amountPaise: order.refundAmountPaise ?? order.netTotalPaise,
      note: `Order #${order.orderNumber} cancelled`,
    });
    order.refundStatus = mapStatus(refund.refund_status);
    order.refundError = order.refundStatus === "FAILED" ? refund.status_description ?? "Refund was cancelled by the gateway." : null;
  } catch (err) {
    order.refundStatus = "FAILED";
    order.refundError = errorText(err);
    console.error(`Refund for order #${order.orderNumber} failed:`, err);
  }
  order.refundAttempts = (order.refundAttempts ?? 0) + 1;
  order.refundUpdatedAt = now;
  order.updatedAt = now;
  await order.save();
  await recordAudit({
    userId,
    action: "GATEWAY_REFUND_REQUESTED",
    entityType: "sales_order",
    entityId: orderId,
    newValue: { refundStatus: order.refundStatus, refundId: order.refundId, amountPaise: order.refundAmountPaise, error: order.refundError },
  });
  if (order.refundStatus === "SUCCESS") notifyOrderEvent(orderId, "REFUND_COMPLETED");
}

/** Staff "Retry refund" button for a refund that keeps failing. */
export async function retryGatewayRefund(orderId: string, userId: string): Promise<void> {
  const order = await Order.findById(orderId);
  if (!order) throw new NotFoundError("Order");
  if (!order.refundStatus) throw new ConflictError("This order has no online refund to retry.");
  if (order.refundStatus === "SUCCESS") throw new ConflictError("This refund has already gone through.");
  await startGatewayRefund(orderId, userId);
}

/**
 * Background sweep: re-checks refunds Cashfree is still processing, and
 * retries failed refund calls a few times before leaving them for staff.
 */
export async function syncGatewayRefunds(): Promise<void> {
  if (!isCashfreeConfigured()) return;
  const pending = await Order.find({ refundStatus: "PENDING" }).limit(50);
  for (const order of pending) {
    try {
      const refund = await fetchCashfreeRefund(order.paymentRef!, order.refundId!);
      const status = mapStatus(refund.refund_status);
      if (status !== order.refundStatus) {
        order.refundStatus = status;
        order.refundError = status === "FAILED" ? refund.status_description ?? "Refund was cancelled by the gateway." : null;
        order.refundUpdatedAt = nowIso();
        await order.save();
        if (status === "SUCCESS") notifyOrderEvent(order._id, "REFUND_COMPLETED");
      }
    } catch (err) {
      // Cashfree has no record of it — the create call never landed. Send it again.
      if (err instanceof AppError && /not found/i.test(err.message)) await startGatewayRefund(order._id);
    }
  }

  const retryBefore = new Date(Date.now() - RETRY_GAP_MS).toISOString();
  const failed = await Order.find({ refundStatus: "FAILED", refundAttempts: { $lt: MAX_AUTO_ATTEMPTS }, refundUpdatedAt: { $lt: retryBefore } }).limit(20);
  for (const order of failed) await startGatewayRefund(order._id);
}

/** Cashfree's refund webhook: apply the new status straight away. */
export async function applyRefundWebhook(cfOrderId: string, refundId: string, cfStatus: string): Promise<void> {
  const order = await Order.findOne({ paymentRef: cfOrderId, refundId });
  if (!order) return;
  const status = mapStatus(cfStatus);
  if (status === order.refundStatus) return;
  order.refundStatus = status;
  order.refundUpdatedAt = nowIso();
  await order.save();
  if (status === "SUCCESS") notifyOrderEvent(order._id, "REFUND_COMPLETED");
}
