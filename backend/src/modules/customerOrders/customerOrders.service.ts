import { CheckoutSession, CustomerProfile, Order, OrderDiscountSub, OrderFeedback, SavedAddress, User } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextSequence } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { AppError, ConflictError, NotFoundError, ValidationError } from "../../utils/errors";
import { getClosingByDate } from "../../utils/businessDate";
import { env } from "../../config/env";
import { buildItemSubs, computeOrderTotals, getOrderFull, getOrderOrThrow, resolveOrderItems, OrderRow } from "../orders/orders.service";
import { CheckoutInput, CreateCustomerOrderInput } from "./customerOrders.types";
import { ForbiddenError } from "../../utils/errors";
import { validatePromoCodeForOrder } from "../promoCodes/promoCodes.service";
import { PromoCode } from "../../db/models";
import { assertRumaliHasMain, assertStoreOpen } from "../storeStatus/storeStatus.service";
import {
  createCashfreeOrder,
  createCashfreeRefund,
  fetchCashfreeOrder,
  isCashfreeConfigured,
  tenDigitPhone,
  terminateCashfreeOrder,
} from "../payments/cashfree.service";
import { refundIdFor } from "../payments/refunds.service";
import { getCashfreePaymentMethodId } from "../paymentMethods/paymentMethods.service";
import { recordBankTransaction } from "../bank/bank.service";
import { notifyCheckoutRefund } from "../notifications/notify.service";

/** How long a customer has to finish paying before the payment is cancelled. */
export const PAYMENT_WINDOW_SECONDS = 5 * 60;

/**
 * The checks that don't depend on prices or payment — run before the customer
 * is sent to pay (so they're never charged for an order that would be refused
 * for a missing name/address) and again when the order is actually created.
 */
function validateOrderBasics(input: Pick<CreateCustomerOrderInput, "orderType" | "items" | "customerName" | "deliveryAddress">) {
  if (input.orderType !== "DINE_IN" && input.orderType !== "TAKEAWAY" && input.orderType !== "DELIVERY") {
    throw new ValidationError("Please choose dine-in, takeaway, or delivery.");
  }
  if (!input.items || input.items.length === 0) {
    throw new ValidationError("An order must have at least one item.");
  }
  if (!input.customerName?.trim()) throw new ValidationError("Please enter your name.");
  if (input.orderType === "DELIVERY" && !input.deliveryAddress?.trim()) throw new ValidationError("Please enter a delivery address.");
}

async function assertOrderingOpenToday() {
  await assertStoreOpen();
  const closing = await getClosingByDate(todayBusinessDate());
  if (closing?.status === "CLOSED") {
    throw new ValidationError("Ordering is closed for today. Please try again tomorrow.");
  }
}

/** Server-side price of a cart: items + promo + delivery fee + packing fee. Never taken from the client. */
async function priceCart(input: Pick<CheckoutInput, "orderType" | "items" | "promoCode" | "packing">, phone: string): Promise<number> {
  const resolvedItems = await resolveOrderItems(input.items);
  assertRumaliHasMain(resolvedItems);
  const subtotalOnly = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  const promo = input.promoCode ? await validatePromoCodeForOrder(input.promoCode, phone, subtotalOnly) : null;
  const { subtotal, net } = computeOrderTotals(resolvedItems, promo?.discountType ?? "FLAT", promo?.discountValue ?? 0);
  return net + (input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0) + packingFeeFor(input.orderType, input.packing, resolvedItems);
}

/**
 * Starts a Cashfree checkout: the amount is computed here from server-side
 * item prices + promo + delivery fee (never taken from the client), then a
 * matching Cashfree order is opened. The whole order the customer is placing
 * is saved alongside it (CheckoutSession), so if their browser never comes
 * back after paying, the webhook/reconciler can still create the order — or
 * refund them. createCustomerOrder later re-checks with Cashfree that this
 * exact order is PAID.
 */
export async function createCashfreeCheckout(
  input: CheckoutInput,
  phone: string
): Promise<{ cashfreeOrderId: string; paymentSessionId: string; amountPaise: number; mode: "sandbox" | "production"; windowSeconds: number }> {
  // Older app versions only send the cart; the full-order checks apply once they send the rest.
  if (input.customerName !== undefined) validateOrderBasics(input);
  await assertOrderingOpenToday();
  const amountPaise = await priceCart(input, phone);
  if (amountPaise < 100) throw new ValidationError("Online payment needs an order total of at least ₹1.");

  const cfOrder = await createCashfreeOrder({ orderId: newId("cf"), amountPaise, phone, name: input.customerName?.trim() || null });
  if (!cfOrder.payment_session_id) {
    throw new AppError(502, "Could not start the payment. Please try again.", "CASHFREE_ERROR", "No payment_session_id in Cashfree response.");
  }
  const now = nowIso();
  const { paymentProvider: _p, cashfreeOrderId: _c, ...orderInput } = input as CreateCustomerOrderInput;
  await CheckoutSession.create({
    _id: cfOrder.order_id,
    phone,
    input: { ...orderInput, orderType: input.orderType },
    amountPaise,
    status: "PENDING",
    createdAt: now,
    updatedAt: now,
  });
  return {
    cashfreeOrderId: cfOrder.order_id,
    paymentSessionId: cfOrder.payment_session_id,
    amountPaise,
    mode: env.cashfreeEnv,
    windowSeconds: PAYMENT_WINDOW_SECONDS,
  };
}

/**
 * Called when the 5-minute payment window runs out (or the customer cancels).
 * If the customer managed to pay at the last second, that's honoured
 * ({ paid: true } — the app then places the order); otherwise the Cashfree
 * order is terminated so it can never be paid afterwards.
 */
export async function cancelCashfreeCheckout(cashfreeOrderId: string, phone: string): Promise<{ paid: boolean }> {
  const cf = await fetchCashfreeOrder(cashfreeOrderId);
  if (cf.customer_details?.customer_phone && cf.customer_details.customer_phone !== tenDigitPhone(phone)) {
    throw new ForbiddenError("This payment isn't yours.");
  }
  if (cf.order_status === "PAID") return { paid: true };
  if (cf.order_status === "ACTIVE") {
    try {
      await terminateCashfreeOrder(cashfreeOrderId);
    } catch {
      // A payment may have been mid-flight and Cashfree refused to close the order — check once more before giving up.
      const again = await fetchCashfreeOrder(cashfreeOrderId);
      if (again.order_status === "PAID") return { paid: true };
    }
  }
  await CheckoutSession.updateOne({ _id: cashfreeOrderId, status: "PENDING" }, { status: "CANCELLED", updatedAt: nowIso() });
  return { paid: false };
}

/**
 * Lightweight "has this been paid yet?" for the payment screen to poll (e.g. a QR
 * scanned on another phone). `orderId` is set once the order exists — it may have
 * been created by the webhook before the app got there.
 */
export async function getCashfreeCheckoutStatus(cashfreeOrderId: string, phone: string): Promise<{ paid: boolean; status: string; orderId: string | null }> {
  const cf = await fetchCashfreeOrder(cashfreeOrderId);
  if (cf.customer_details?.customer_phone && cf.customer_details.customer_phone !== tenDigitPhone(phone)) {
    throw new ForbiddenError("This payment isn't yours.");
  }
  const order = await Order.findOne({ paymentRef: cashfreeOrderId }).select("_id").lean();
  return { paid: cf.order_status === "PAID", status: cf.order_status, orderId: order?._id ?? null };
}

/**
 * Trust nothing from the browser: ask Cashfree directly whether this order is
 * PAID, for exactly the amount this cart costs, by this customer's phone.
 */
async function verifyCashfreePayment(cashfreeOrderId: string, expectedAmountPaise: number, phone: string): Promise<void> {
  const cf = await fetchCashfreeOrder(cashfreeOrderId);
  if (cf.order_status !== "PAID") {
    throw new ValidationError(
      cf.order_status === "ACTIVE"
        ? "Payment wasn't completed, so your order was not placed."
        : "This payment has expired or failed. Please try again."
    );
  }
  if (Math.round(cf.order_amount * 100) !== expectedAmountPaise) {
    throw new ValidationError("The paid amount doesn't match your order total. Please contact us.");
  }
  if (cf.customer_details?.customer_phone && cf.customer_details.customer_phone !== tenDigitPhone(phone)) {
    throw new ValidationError("This payment was made for a different number.");
  }
}

/**
 * Makes sure a checkout ends as an order or a refund — never as money taken
 * with nothing to show for it. Run by the Cashfree webhook and by a background
 * sweep (the backstop when webhooks can't reach us).
 */
export async function reconcileCheckout(cashfreeOrderId: string): Promise<void> {
  const co = await CheckoutSession.findById(cashfreeOrderId);
  if (!co || (co.status !== "PENDING" && co.status !== "CANCELLED")) return;

  const existing = await Order.findOne({ paymentRef: cashfreeOrderId }).select("_id").lean();
  if (existing) {
    co.status = "COMPLETED";
    co.orderId = existing._id;
    co.updatedAt = nowIso();
    await co.save();
    return;
  }

  const cf = await fetchCashfreeOrder(cashfreeOrderId);
  if (cf.order_status === "PAID") {
    try {
      const order = await createCustomerOrder(
        { ...(co.input as unknown as CreateCustomerOrderInput), paymentProvider: "CASHFREE", cashfreeOrderId },
        co.phone
      );
      co.status = "COMPLETED";
      co.orderId = order.id;
      co.updatedAt = nowIso();
      await co.save();
    } catch (err) {
      // Only a business refusal (store closed, item gone, amount changed…) is final.
      // A crash / network problem is left PENDING and retried on the next sweep.
      if (!(err instanceof AppError) || err.status >= 500) throw err;
      await refundOrphanCheckout(co, Math.round(cf.order_amount * 100), err.publicMessage);
    }
    return;
  }

  if (co.status === "CANCELLED") return;
  const ageMs = Date.now() - new Date(co.createdAt).getTime();
  if (cf.order_status === "ACTIVE" && ageMs > (PAYMENT_WINDOW_SECONDS + 120) * 1000) {
    try {
      await terminateCashfreeOrder(cashfreeOrderId);
    } catch {
      return; // possibly paid at this very moment — the next sweep sees it
    }
    co.status = "CANCELLED";
  } else if (cf.order_status === "EXPIRED" || cf.order_status === "TERMINATED") {
    co.status = "CANCELLED";
  } else {
    return;
  }
  co.updatedAt = nowIso();
  await co.save();
}

async function refundOrphanCheckout(co: InstanceType<typeof CheckoutSession>, amountPaise: number, reason: string) {
  const refundId = refundIdFor(co._id);
  co.refundId = refundId;
  co.note = reason;
  try {
    await createCashfreeRefund({ orderId: co._id, refundId, amountPaise, note: "Order could not be placed" });
    co.status = "REFUNDED";
  } catch (err) {
    co.status = "REFUND_FAILED";
    console.error(`Refund of orphan payment ${co._id} failed:`, err);
  }
  co.updatedAt = nowIso();
  await co.save();
  await recordAudit({
    userId: null,
    action: co.status === "REFUNDED" ? "ORPHAN_PAYMENT_REFUNDED" : "ORPHAN_PAYMENT_REFUND_FAILED",
    entityType: "checkout",
    entityId: co._id,
    newValue: { amountPaise, phone: co.phone, refundId },
    reason,
  });
  if (co.status === "REFUNDED") {
    notifyCheckoutRefund(co.phone, String((co.input as { customerName?: string }).customerName ?? ""), amountPaise, reason);
  }
}

/** Background sweep: settle checkouts whose browser never came back. */
export async function reconcileStaleCheckouts(): Promise<void> {
  if (!isCashfreeConfigured()) return;
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const oneDayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const halfHourAgo = new Date(Date.now() - 30 * 60_000).toISOString();
  const stale = await CheckoutSession.find({
    $or: [
      { status: "PENDING", createdAt: { $lt: oneMinuteAgo, $gt: oneDayAgo } },
      // Cancelled at the timer, but a payment could still have landed in the last instant.
      { status: "CANCELLED", createdAt: { $gt: halfHourAgo } },
    ],
  }).limit(30);
  for (const co of stale) {
    await reconcileCheckout(co._id).catch((err) => console.error(`Reconcile ${co._id} failed:`, err));
  }
  // Orphan refunds that failed: retry them too.
  const failed = await CheckoutSession.find({ status: "REFUND_FAILED", createdAt: { $gt: oneDayAgo } }).limit(10);
  for (const co of failed) {
    await refundOrphanCheckout(co, co.amountPaise, co.note ?? "Order could not be placed").catch(() => undefined);
  }
}

/** Staff view: payments taken online that never became an order. */
export async function listProblemCheckouts() {
  const docs = await CheckoutSession.find({ status: { $in: ["REFUNDED", "REFUND_FAILED"] } }).sort({ createdAt: -1 }).limit(50).lean();
  return docs.map((d) => ({
    id: d._id,
    phone: d.phone,
    customer_name: (d.input as { customerName?: string }).customerName ?? null,
    amount_paise: d.amountPaise,
    status: d.status,
    reason: d.note,
    created_at: d.createdAt,
  }));
}

export async function createCustomerOrder(input: CreateCustomerOrderInput, phone: string): Promise<OrderRow> {
  validateOrderBasics(input);

  const customerName = input.customerName!.trim();
  const deliveryAddress = input.orderType === "DELIVERY" ? input.deliveryAddress?.trim() || null : null;
  const deliveryLatitude = input.orderType === "DELIVERY" ? input.deliveryLatitude ?? null : null;
  const deliveryLongitude = input.orderType === "DELIVERY" ? input.deliveryLongitude ?? null : null;
  if (input.orderType === "DELIVERY") {
    if (input.paymentProvider !== "MOCK" && input.paymentProvider !== "COD" && input.paymentProvider !== "CASHFREE") {
      throw new ValidationError("Please choose a payment method for delivery.");
    }
    // MOCK is a test-only "paid" path so the delivery flow can be exercised
    // end-to-end without a gateway. Refused outside dev/test so a live
    // deployment can never accept a "paid" order that nobody actually paid for.
    if (input.paymentProvider === "MOCK" && env.isProd) {
      throw new ValidationError("Online payment for delivery isn't set up yet — please choose Cash on Delivery.");
    }
  }

  const isCashfreeDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "CASHFREE";
  if (isCashfreeDelivery) {
    if (!input.cashfreeOrderId) throw new ValidationError("Payment details are missing. Please try paying again.");
    if (!isCashfreeConfigured()) throw new ValidationError("Online payment isn't set up yet — please choose Cash on Delivery.");
    // This payment already became an order (the webhook got there first, or this
    // is a retry) — hand back that order instead of refusing a customer who paid.
    const paidFor = await Order.findOne({ paymentRef: input.cashfreeOrderId }).select("_id customerPhone").lean();
    if (paidFor) {
      if (paidFor.customerPhone !== phone) throw new ValidationError("This payment has already been used for an order.");
      return getOrderOrThrow(paidFor._id);
    }
  }

  // A retried/duplicated submit (double-tap, refresh, network retry) with
  // the same client-generated key returns the order already created for
  // it instead of placing a second one.
  if (input.idempotencyKey) {
    const existing = await Order.findOne({ clientIdempotencyKey: input.idempotencyKey });
    if (existing) return getOrderOrThrow(existing._id);
  }

  await assertOrderingOpenToday();
  const businessDate = todayBusinessDate();

  const tableLabel = input.orderType === "DINE_IN" ? input.tableLabel?.trim() || null : null;
  const isMockPaidDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "MOCK";
  const isCodDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "COD";

  const resolvedItems = await resolveOrderItems(input.items);
  assertRumaliHasMain(resolvedItems);
  const subtotalOnly = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  // Re-validated here even though createCashfreeCheckout already checked it —
  // this is the call that actually commits, so it can never trust a
  // client-held "this code was valid a minute ago".
  const promo = input.promoCode ? await validatePromoCodeForOrder(input.promoCode, phone, subtotalOnly) : null;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(
    resolvedItems,
    promo?.discountType ?? "FLAT",
    promo?.discountValue ?? 0
  );
  const deliveryFeePaise = input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0;
  const packingFeePaise = packingFeeFor(input.orderType, input.packing, resolvedItems);
  const totalPaise = net + deliveryFeePaise + packingFeePaise;
  // Cashfree's money is booked as a real payment (order payment line + bank credit),
  // so day totals and the bank balance include it — and a cancellation reverses it.
  const cashfreeMethodId = isCashfreeDelivery ? await getCashfreePaymentMethodId() : null;
  if (isCashfreeDelivery) {
    await verifyCashfreePayment(input.cashfreeOrderId!, totalPaise, phone);
  }
  const now = nowIso();

  let orderId: string;
  try {
    orderId = await withTransaction(async (session) => {
    const orderNumber = await nextSequence("order_number", session);
    const newOrderId = newId("order");
    const { items, discounts } = buildItemSubs(resolvedItems, now, undefined);

    await Order.create(
      [
        {
          _id: newOrderId,
          orderNumber,
          businessDate,
          orderType: input.orderType,
          // Every customer self-order — paid or COD — starts out waiting on
          // staff to accept it (see acceptOrder/orders.service.ts) before it
          // enters the normal kitchen pipeline. Payment, if any, is already
          // settled by this point regardless: a prepaid order only ever
          // reaches here after "payment" succeeded, and COD is just
          // collected at the door either way.
          status: "PENDING_ACCEPTANCE",
          paymentStatus: isMockPaidDelivery || isCashfreeDelivery ? "PAID" : "UNPAID",
          customerName,
          customerPhone: phone,
          deliveryAddress,
          deliveryLatitude,
          deliveryLongitude,
          subtotalPaise: subtotal,
          discountPaise: orderDiscountPaise,
          discountType: promo?.discountType ?? "FLAT",
          discountValue: promo?.discountValue ?? 0,
          discountReason: promo ? `Promo code: ${promo.code}` : null,
          promoCode: promo?.code ?? null,
          itemDiscountTotalPaise: itemDiscountTotal,
          deliveryFeePaise,
          packingFeePaise,
          netTotalPaise: totalPaise,
          notes: isMockPaidDelivery
            ? `[TEST PAYMENT — not real money]${input.notes ? ` ${input.notes}` : ""}`
            : isCashfreeDelivery
              ? `[Paid via Cashfree${env.cashfreeEnv === "sandbox" ? " — TEST MODE" : ""}]${input.notes ? ` ${input.notes}` : ""}`
              : isCodDelivery
              ? `Cash on Delivery${input.notes ? ` — ${input.notes}` : ""}`
              : tableLabel
                ? `Table: ${tableLabel}${input.notes ? ` — ${input.notes}` : ""}`
                : input.notes ?? null,
          createdBy: null,
          confirmedAt: null,
          createdAt: now,
          updatedAt: now,
          clientIdempotencyKey: input.idempotencyKey ?? undefined,
          paymentRef: isCashfreeDelivery ? input.cashfreeOrderId : undefined,
          items,
          payments: cashfreeMethodId
            ? [
                {
                  _id: newId("pay"),
                  paymentMethodId: cashfreeMethodId,
                  amountPaise: totalPaise,
                  reference: input.cashfreeOrderId,
                  status: "ACTIVE",
                  createdBy: null,
                  createdAt: now,
                },
              ]
            : [],
          discounts: discounts as OrderDiscountSub[],
        },
      ],
      { session }
    );

    if (cashfreeMethodId) {
      await recordBankTransaction(
        {
          businessDate,
          txnType: "CREDIT",
          amountPaise: totalPaise,
          description: `Sale — order #${orderNumber} (paid online via Cashfree)`,
          reference: input.cashfreeOrderId,
          category: "BUSINESS",
          paymentMethodId: cashfreeMethodId,
          userId: null,
        },
        session
      );
    }

    await recordAudit(
      {
        userId: null,
        action: "CUSTOMER_ORDER_CREATED",
        entityType: "sales_order",
        entityId: newOrderId,
        newValue: { orderNumber, subtotal, net, packingFeePaise, itemCount: resolvedItems.length, phone, orderType: input.orderType, promoCode: promo?.code ?? null },
      },
      session
    );

    if (promo) {
      await PromoCode.updateOne({ _id: promo._id }, { $inc: { usedCount: 1 } }, { session });
    }

      return newOrderId;
    });
  } catch (err) {
    // Two near-simultaneous requests with the same idempotency key (e.g. a
    // double-tap that fires before the first request's guard above even
    // ran) collide on the unique index instead of the earlier check —
    // fall back to returning whichever one actually landed.
    if (isDuplicateKeyError(err)) {
      const existing =
        (input.idempotencyKey && (await Order.findOne({ clientIdempotencyKey: input.idempotencyKey }))) ||
        (isCashfreeDelivery && (await Order.findOne({ paymentRef: input.cashfreeOrderId })));
      if (existing) return getOrderOrThrow(existing._id);
    }
    throw err;
  }

  if (isCashfreeDelivery) {
    await CheckoutSession.updateOne({ _id: input.cashfreeOrderId }, { status: "COMPLETED", orderId, updatedAt: nowIso() });
  }
  await rememberCustomerDetails(phone, customerName, deliveryAddress, deliveryLatitude, deliveryLongitude).catch((err) =>
    console.error("Could not save customer profile:", err)
  );
  return getOrderOrThrow(orderId);
}

const MAX_SAVED_ADDRESSES = 5;

/** So the next checkout is pre-filled: their name and their last few delivery addresses. */
async function rememberCustomerDetails(phone: string, name: string, address: string | null, lat: number | null, lng: number | null) {
  const now = nowIso();
  const profile = (await CustomerProfile.findById(phone)) ?? new CustomerProfile({ _id: phone, addresses: [], updatedAt: now });
  profile.name = name;
  if (address) {
    const key = address.toLowerCase().replace(/\s+/g, " ");
    const same = profile.addresses.find((a) => a.address.toLowerCase().replace(/\s+/g, " ") === key);
    if (same) {
      same.lastUsedAt = now;
      if (lat != null && lng != null) {
        same.latitude = lat;
        same.longitude = lng;
      }
    } else {
      profile.addresses.push({ _id: newId("addr"), address, latitude: lat, longitude: lng, lastUsedAt: now } as SavedAddress);
    }
    profile.addresses.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    profile.addresses.splice(MAX_SAVED_ADDRESSES);
  }
  profile.updatedAt = now;
  await profile.save();
}

export async function getCustomerProfile(phone: string) {
  const p = await CustomerProfile.findById(phone).lean();
  return {
    name: p?.name ?? null,
    whatsapp_opt_in: p?.whatsappOptIn ?? true,
    addresses: (p?.addresses ?? []).map((a) => ({ id: a._id, address: a.address, latitude: a.latitude, longitude: a.longitude })),
  };
}

export async function deleteSavedAddress(phone: string, addressId: string) {
  await CustomerProfile.updateOne({ _id: phone }, { $pull: { addresses: { _id: addressId } }, updatedAt: nowIso() });
}

export async function setWhatsappOptIn(phone: string, optIn: boolean) {
  await CustomerProfile.updateOne({ _id: phone }, { whatsappOptIn: optIn, updatedAt: nowIso() }, { upsert: true });
}

/** A customer's own order history — most recent first, summary fields only. */
export async function listCustomerOrders(phone: string): Promise<OrderRow[]> {
  const docs = await Order.find({ customerPhone: phone }).sort({ createdAt: -1 }).limit(50);
  return Promise.all(docs.map((doc) => getOrderOrThrow(doc._id)));
}

/** A single past order for its own customer — verifies ownership before returning anything. */
export async function getCustomerOrderOrThrow(orderId: string, phone: string) {
  const order = await getOrderFull(orderId);
  if (order.customer_phone !== phone) {
    throw new ForbiddenError("This order isn't yours.");
  }
  return order;
}

/** Rider's first name + number, shown to the customer only while their order is on its way. */
export async function getRiderContact(riderId: string | null): Promise<{ name: string; phone: string | null } | null> {
  if (!riderId) return null;
  const rider = await User.findById(riderId).select("fullName phone").lean();
  return rider ? { name: rider.fullName.split(" ")[0], phone: rider.phone ?? null } : null;
}

/** A private 1–5 rating of a finished order — goes to the owner, one per order. */
export async function submitOrderFeedback(orderId: string, phone: string, rating: number, comment: string | null) {
  const order = await Order.findById(orderId).select("customerPhone status orderNumber").lean();
  if (!order) throw new NotFoundError("Order");
  if (order.customerPhone !== phone) throw new ForbiddenError("This order isn't yours.");
  if (order.status !== "COMPLETED" && order.status !== "DELIVERED") {
    throw new ValidationError("You can rate your order once it's done.");
  }
  if (await OrderFeedback.exists({ _id: orderId })) throw new ConflictError("You've already rated this order — thank you!");
  await OrderFeedback.create({ _id: orderId, orderNumber: order.orderNumber, phone, rating, comment: comment?.trim() || null, createdAt: nowIso() });
}

export async function getOrderFeedback(orderId: string): Promise<{ rating: number; comment: string | null } | null> {
  const f = await OrderFeedback.findById(orderId).lean();
  return f ? { rating: f.rating, comment: f.comment } : null;
}

/** Staff view of customer ratings, newest first, with the average. */
export async function listFeedback(limit = 100) {
  const docs = await OrderFeedback.find().sort({ createdAt: -1 }).limit(limit).lean();
  const agg = await OrderFeedback.aggregate([{ $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } }]);
  const names = new Map(
    (await Order.find({ _id: { $in: docs.map((d) => d._id) } }).select("customerName").lean()).map((o) => [o._id, o.customerName])
  );
  return {
    average: agg[0] ? Math.round(agg[0].avg * 10) / 10 : null,
    count: agg[0]?.count ?? 0,
    feedback: docs.map((d) => ({
      order_id: d._id,
      order_number: d.orderNumber,
      customer_name: names.get(d._id) ?? null,
      phone: d.phone,
      rating: d.rating,
      comment: d.comment,
      created_at: d.createdAt,
    })),
  };
}

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

/** ₹0–99 → ₹40, ₹100–149 → ₹30, ₹150+ → free. Computed server-side (never trusted from the client) since it directly affects the payable total. */
function deliveryFeeFor(subtotalPaise: number): number {
  if (subtotalPaise < 10000) return 4000;
  if (subtotalPaise < 15000) return 3000;
  return 0;
}

/** Packing charge per plate: ₹5 per half plate, ₹9 per full plate. Only for takeaway/delivery, and only when the customer kept packing on. */
const PACKING_FEE_PAISE = { HALF: 500, FULL: 900, SINGLE: 0 } as const;

function packingFeeFor(orderType: string, packing: boolean | undefined, items: { priceType: "HALF" | "FULL" | "SINGLE"; quantity: number }[]): number {
  if (orderType === "DINE_IN" || !packing) return 0;
  return items.reduce((s, i) => s + PACKING_FEE_PAISE[i.priceType] * i.quantity, 0);
}
