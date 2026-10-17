import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireCustomerAuth } from "../../middleware/customerAuth";
import * as customerOrdersService from "../customerOrders/customerOrders.service";
import { pushPublicKey, removePushSubscription, savePushSubscription, whatsappEnabled } from "../notifications/notify.service";

/** The signed-in customer's saved details (name, recent addresses, WhatsApp opt-in). */
export const customerProfileRouter = Router();

customerProfileRouter.get(
  "/",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    res.json({ ...(await customerOrdersService.getCustomerProfile(req.customer!.phone)), whatsapp_available: whatsappEnabled() });
  })
);

customerProfileRouter.post(
  "/addresses/:id/delete",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    await customerOrdersService.deleteSavedAddress(req.customer!.phone, req.params.id);
    res.json({ ok: true });
  })
);

customerProfileRouter.post(
  "/whatsapp",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const { optIn } = z.object({ optIn: z.boolean() }).parse(req.body);
    await customerOrdersService.setWhatsappOptIn(req.customer!.phone, optIn);
    res.json({ ok: true });
  })
);

/** Web Push: the app asks for the public key, subscribes the browser, and registers it here. */
export const customerPushRouter = Router();

customerPushRouter.get("/config", (_req, res) => {
  res.json({ publicKey: pushPublicKey() });
});

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});

customerPushRouter.post(
  "/subscribe",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    await savePushSubscription(req.customer!.phone, subscriptionSchema.parse(req.body));
    res.status(201).json({ ok: true });
  })
);

customerPushRouter.post(
  "/unsubscribe",
  requireCustomerAuth,
  asyncHandler(async (req, res) => {
    const { endpoint } = z.object({ endpoint: z.string().max(1000) }).parse(req.body);
    await removePushSubscription(req.customer!.phone, endpoint);
    res.json({ ok: true });
  })
);
