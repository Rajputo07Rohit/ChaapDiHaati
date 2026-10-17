import express, { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { verifyCashfreeWebhookSignature } from "./cashfree.service";
import { applyRefundWebhook } from "./refunds.service";
import { reconcileCheckout } from "../customerOrders/customerOrders.service";
import { CheckoutSession } from "../../db/models";

/**
 * Cashfree → us, server to server. Set this URL in the Cashfree dashboard
 * (Developers → Webhooks), for payment and refund events:
 *   https://<backend>/api/public/payments/cashfree/webhook
 *
 * It's what makes a payment safe even if the customer's phone dies right after
 * paying: the order is created (or the money refunded) from the saved checkout.
 * Needs the raw body for the signature check, so it's mounted before express.json.
 */
export const cashfreeWebhookRouter = Router();

cashfreeWebhookRouter.post(
  "/",
  express.raw({ type: "*/*", limit: "200kb" }),
  asyncHandler(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    const ok = verifyCashfreeWebhookSignature(raw, req.header("x-webhook-timestamp"), req.header("x-webhook-signature"));
    if (!ok) {
      res.status(401).json({ error: { message: "Bad signature.", code: "UNAUTHORIZED" } });
      return;
    }

    let event: { type?: string; data?: { order?: { order_id?: string }; refund?: { order_id?: string; refund_id?: string; refund_status?: string } } };
    try {
      event = JSON.parse(raw);
    } catch {
      res.status(400).json({ error: { message: "Bad JSON.", code: "VALIDATION_ERROR" } });
      return;
    }

    const type = event.type ?? "";
    if (type.startsWith("PAYMENT_") && event.data?.order?.order_id) {
      // Success, failure or "user dropped" — reconcile decides from Cashfree's own record, not from this payload.
      await reconcileCheckout(event.data.order.order_id);
    } else if (type.startsWith("REFUND_") && event.data?.refund?.order_id && event.data.refund.refund_id) {
      const r = event.data.refund;
      await applyRefundWebhook(r.order_id!, r.refund_id!, r.refund_status ?? "PENDING");
      if (r.refund_status === "SUCCESS") {
        await CheckoutSession.updateOne({ _id: r.order_id, refundId: r.refund_id, status: "REFUND_FAILED" }, { status: "REFUNDED" });
      }
    }
    res.json({ ok: true });
  })
);
