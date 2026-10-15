import crypto from "crypto";
import Razorpay from "razorpay";
import { Order, OrderDiscountSub } from "../../db/models";
import { newId, nowIso, todayBusinessDate } from "../../utils/ids";
import { nextSequence } from "../../utils/sequence";
import { recordAudit } from "../../utils/audit";
import { withTransaction } from "../../db/mongoose";
import { AppError, ValidationError } from "../../utils/errors";
import { getClosingByDate } from "../../utils/businessDate";
import { env } from "../../config/env";
import { buildItemSubs, computeOrderTotals, getOrderFull, getOrderOrThrow, resolveOrderItems, OrderRow } from "../orders/orders.service";
import { CreateCustomerOrderInput, CreateRazorpayOrderInput } from "./customerOrders.types";
import { ForbiddenError } from "../../utils/errors";
import { validatePromoCodeForOrder } from "../promoCodes/promoCodes.service";
import { PromoCode } from "../../db/models";
import { assertRumaliHasMain, assertStoreOpen } from "../storeStatus/storeStatus.service";
import { createCashfreeOrder, fetchCashfreeOrder, isCashfreeConfigured, tenDigitPhone, terminateCashfreeOrder } from "../payments/cashfree.service";

let razorpayClient: Razorpay | null = null;
function getRazorpayClient(): Razorpay {
  if (!env.razorpayKeyId || !env.razorpayKeySecret) {
    throw new AppError(500, "Online payment isn't configured yet. Please choose Cash on Delivery.", "RAZORPAY_NOT_CONFIGURED", "Missing RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET env vars.");
  }
  if (!razorpayClient) {
    razorpayClient = new Razorpay({ key_id: env.razorpayKeyId, key_secret: env.razorpayKeySecret });
  }
  return razorpayClient;
}

/**
 * Computes the payable amount the same way createCustomerOrder will, and
 * opens a matching Razorpay order for it — the amount is never taken from
 * the client, only from server-resolved item prices + delivery fee.
 */
export async function createRazorpayOrder(input: CreateRazorpayOrderInput, phone: string): Promise<{ razorpayOrderId: string; amountPaise: number; keyId: string }> {
  await assertStoreOpen();
  const resolvedItems = await resolveOrderItems(input.items);
  assertRumaliHasMain(resolvedItems);
  const subtotalOnly = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  const promo = input.promoCode ? await validatePromoCodeForOrder(input.promoCode, phone, subtotalOnly) : null;
  const { subtotal, net } = computeOrderTotals(resolvedItems, promo?.discountType ?? "FLAT", promo?.discountValue ?? 0);
  const deliveryFeePaise = input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0;
  const amountPaise = net + deliveryFeePaise;

  const client = getRazorpayClient();
  const order = await client.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt: newId("rzp"),
  });

  return { razorpayOrderId: order.id, amountPaise, keyId: env.razorpayKeyId! };
}

/**
 * Starts a Cashfree checkout: the amount is computed here from server-side
 * item prices + promo + delivery fee (never taken from the client), then a
 * matching Cashfree order is opened. The customer pays in Cashfree's popup;
 * createCustomerOrder later re-checks with Cashfree that this exact order is PAID.
 */
/** How long a customer has to finish paying before the payment is cancelled. */
export const PAYMENT_WINDOW_SECONDS = 5 * 60;

export async function createCashfreeCheckout(
  input: CreateRazorpayOrderInput,
  phone: string
): Promise<{ cashfreeOrderId: string; paymentSessionId: string; amountPaise: number; mode: "sandbox" | "production"; windowSeconds: number }> {
  await assertStoreOpen();
  const resolvedItems = await resolveOrderItems(input.items);
  assertRumaliHasMain(resolvedItems);
  const subtotalOnly = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  const promo = input.promoCode ? await validatePromoCodeForOrder(input.promoCode, phone, subtotalOnly) : null;
  const { subtotal, net } = computeOrderTotals(resolvedItems, promo?.discountType ?? "FLAT", promo?.discountValue ?? 0);
  const amountPaise = net + (input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0);
  if (amountPaise < 100) throw new ValidationError("Online payment needs an order total of at least ₹1.");

  const cfOrder = await createCashfreeOrder({ orderId: newId("cf"), amountPaise, phone });
  if (!cfOrder.payment_session_id) {
    throw new AppError(502, "Could not start the payment. Please try again.", "CASHFREE_ERROR", "No payment_session_id in Cashfree response.");
  }
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
  return { paid: false };
}

/** Lightweight "has this been paid yet?" for the payment screen to poll (e.g. a QR scanned on another phone). */
export async function getCashfreeCheckoutStatus(cashfreeOrderId: string, phone: string): Promise<{ paid: boolean; status: string }> {
  const cf = await fetchCashfreeOrder(cashfreeOrderId);
  if (cf.customer_details?.customer_phone && cf.customer_details.customer_phone !== tenDigitPhone(phone)) {
    throw new ForbiddenError("This payment isn't yours.");
  }
  return { paid: cf.order_status === "PAID", status: cf.order_status };
}

/**
 * Trust nothing from the browser: ask Cashfree directly whether this order is
 * PAID, for exactly the amount this cart costs, by this customer's phone, and
 * that it hasn't already paid for a different order.
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
  if (await Order.exists({ paymentRef: cashfreeOrderId })) {
    throw new ValidationError("This payment has already been used for an order.");
  }
}

function verifyRazorpaySignature(orderId: string, paymentId: string, signature: string): boolean {
  const expected = crypto
    .createHmac("sha256", env.razorpayKeySecret!)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
}

export async function createCustomerOrder(input: CreateCustomerOrderInput, phone: string): Promise<OrderRow> {
  if (input.orderType !== "DINE_IN" && input.orderType !== "TAKEAWAY" && input.orderType !== "DELIVERY") {
    throw new ValidationError("Please choose dine-in, takeaway, or delivery.");
  }
  if (!input.items || input.items.length === 0) {
    throw new ValidationError("An order must have at least one item.");
  }

  const customerName = input.customerName?.trim() || null;
  if (!customerName) throw new ValidationError("Please enter your name.");
  const deliveryAddress = input.orderType === "DELIVERY" ? input.deliveryAddress?.trim() || null : null;
  const deliveryLatitude = input.orderType === "DELIVERY" ? input.deliveryLatitude ?? null : null;
  const deliveryLongitude = input.orderType === "DELIVERY" ? input.deliveryLongitude ?? null : null;
  if (input.orderType === "DELIVERY") {
    if (!deliveryAddress) throw new ValidationError("Please enter a delivery address.");
    if (input.paymentProvider !== "MOCK" && input.paymentProvider !== "COD" && input.paymentProvider !== "RAZORPAY" && input.paymentProvider !== "CASHFREE") {
      throw new ValidationError("Please choose a payment method for delivery.");
    }
    // Real online payment isn't wired up yet — MOCK is a placeholder path
    // so that part of the delivery flow can be tested end-to-end today.
    // Refused outside dev/test so a live deployment can never accept a
    // "paid" delivery order that nobody actually paid for. COD/RAZORPAY have
    // no such restriction — Razorpay is a real gateway (running in test
    // mode for now), and COD is collected at the door either way.
    if (input.paymentProvider === "MOCK" && env.isProd) {
      throw new ValidationError("Online payment for delivery isn't set up yet — please choose Cash on Delivery.");
    }
  }

  const isRazorpayDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "RAZORPAY";
  if (isRazorpayDelivery) {
    if (!input.razorpayOrderId || !input.razorpayPaymentId || !input.razorpaySignature) {
      throw new ValidationError("Payment details are missing. Please try paying again.");
    }
    if (!verifyRazorpaySignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
      throw new ValidationError("Payment could not be verified. Please try again or choose Cash on Delivery.");
    }
  }

  const isCashfreeDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "CASHFREE";
  if (isCashfreeDelivery) {
    if (!input.cashfreeOrderId) throw new ValidationError("Payment details are missing. Please try paying again.");
    if (!isCashfreeConfigured()) throw new ValidationError("Online payment isn't set up yet — please choose Cash on Delivery.");
  }

  // A retried/duplicated submit (double-tap, refresh, network retry) with
  // the same client-generated key returns the order already created for
  // it instead of placing a second one.
  if (input.idempotencyKey) {
    const existing = await Order.findOne({ clientIdempotencyKey: input.idempotencyKey });
    if (existing) return getOrderOrThrow(existing._id);
  }

  await assertStoreOpen();
  const businessDate = todayBusinessDate();
  const closing = await getClosingByDate(businessDate);
  if (closing?.status === "CLOSED") {
    throw new ValidationError("Ordering is closed for today. Please try again tomorrow.");
  }

  const tableLabel = input.orderType === "DINE_IN" ? input.tableLabel?.trim() || null : null;
  const isMockPaidDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "MOCK";
  const isCodDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "COD";

  const resolvedItems = await resolveOrderItems(input.items);
  assertRumaliHasMain(resolvedItems);
  const subtotalOnly = resolvedItems.reduce((s, i) => s + i.lineSubtotalPaise, 0);
  // Re-validated here even though createRazorpayOrder already checked it for
  // the Razorpay path — this is the call that actually charges/commits, so
  // it can never trust a client-held "this code was valid a minute ago".
  const promo = input.promoCode ? await validatePromoCodeForOrder(input.promoCode, phone, subtotalOnly) : null;
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(
    resolvedItems,
    promo?.discountType ?? "FLAT",
    promo?.discountValue ?? 0
  );
  const deliveryFeePaise = input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0;
  if (isCashfreeDelivery) {
    await verifyCashfreePayment(input.cashfreeOrderId!, net + deliveryFeePaise, phone);
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
          paymentStatus: isMockPaidDelivery || isRazorpayDelivery || isCashfreeDelivery ? "PAID" : "UNPAID",
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
          netTotalPaise: net + deliveryFeePaise,
          notes: isMockPaidDelivery
            ? `[TEST PAYMENT — not real money]${input.notes ? ` ${input.notes}` : ""}`
            : isRazorpayDelivery
              ? `[Paid via Razorpay — TEST MODE]${input.notes ? ` ${input.notes}` : ""}`
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
          payments: [],
          discounts: discounts as OrderDiscountSub[],
        },
      ],
      { session }
    );

    await recordAudit(
      {
        userId: null,
        action: "CUSTOMER_ORDER_CREATED",
        entityType: "sales_order",
        entityId: newOrderId,
        newValue: { orderNumber, subtotal, net, itemCount: resolvedItems.length, phone, orderType: input.orderType, promoCode: promo?.code ?? null },
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
    if (input.idempotencyKey && isDuplicateKeyError(err)) {
      const existing = await Order.findOne({ clientIdempotencyKey: input.idempotencyKey });
      if (existing) return getOrderOrThrow(existing._id);
    }
    throw err;
  }

  return getOrderOrThrow(orderId);
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

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

/** ₹0–99 → ₹40, ₹100–149 → ₹30, ₹150+ → free. Computed server-side (never trusted from the client) since it directly affects the payable total. */
function deliveryFeeFor(subtotalPaise: number): number {
  if (subtotalPaise < 10000) return 4000;
  if (subtotalPaise < 15000) return 3000;
  return 0;
}
