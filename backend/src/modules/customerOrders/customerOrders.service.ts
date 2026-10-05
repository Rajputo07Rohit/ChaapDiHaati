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
import { buildItemSubs, computeOrderTotals, getOrderOrThrow, resolveOrderItems, OrderRow } from "../orders/orders.service";
import { CreateCustomerOrderInput, CreateRazorpayOrderInput } from "./customerOrders.types";

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
export async function createRazorpayOrder(input: CreateRazorpayOrderInput): Promise<{ razorpayOrderId: string; amountPaise: number; keyId: string }> {
  const resolvedItems = await resolveOrderItems(input.items);
  const { subtotal, net } = computeOrderTotals(resolvedItems, "FLAT", 0);
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
  const deliveryAddress = input.orderType === "DELIVERY" ? input.deliveryAddress?.trim() || null : null;
  const deliveryLatitude = input.orderType === "DELIVERY" ? input.deliveryLatitude ?? null : null;
  const deliveryLongitude = input.orderType === "DELIVERY" ? input.deliveryLongitude ?? null : null;
  if (input.orderType === "DELIVERY") {
    if (!customerName) throw new ValidationError("Please enter your name.");
    if (!deliveryAddress) throw new ValidationError("Please enter a delivery address.");
    if (input.paymentProvider !== "MOCK" && input.paymentProvider !== "COD" && input.paymentProvider !== "RAZORPAY") {
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

  // A retried/duplicated submit (double-tap, refresh, network retry) with
  // the same client-generated key returns the order already created for
  // it instead of placing a second one.
  if (input.idempotencyKey) {
    const existing = await Order.findOne({ clientIdempotencyKey: input.idempotencyKey });
    if (existing) return getOrderOrThrow(existing._id);
  }

  const businessDate = todayBusinessDate();
  const closing = await getClosingByDate(businessDate);
  if (closing?.status === "CLOSED") {
    throw new ValidationError("Ordering is closed for today. Please try again tomorrow.");
  }

  const tableLabel = input.orderType === "DINE_IN" ? input.tableLabel?.trim() || null : null;
  const isMockPaidDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "MOCK";
  const isCodDelivery = input.orderType === "DELIVERY" && input.paymentProvider === "COD";

  const resolvedItems = await resolveOrderItems(input.items);
  const { subtotal, itemDiscountTotal, orderDiscountPaise, net } = computeOrderTotals(resolvedItems, "FLAT", 0);
  const deliveryFeePaise = input.orderType === "DELIVERY" ? deliveryFeeFor(subtotal) : 0;
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
          // A prepaid (mock-today) delivery order only ever gets created
          // here after "payment" has already succeeded — no pending/unpaid
          // row for Kitchen to pick up before that. A COD delivery order,
          // like dine-in/takeaway, is confirmed immediately and settled at
          // the door — that's the whole point of COD, so it's visible to
          // Kitchen right away, same as any other unpaid confirmed order.
          status: "CONFIRMED",
          paymentStatus: isMockPaidDelivery || isRazorpayDelivery ? "PAID" : "UNPAID",
          customerName,
          customerPhone: phone,
          deliveryAddress,
          deliveryLatitude,
          deliveryLongitude,
          subtotalPaise: subtotal,
          discountPaise: orderDiscountPaise,
          discountType: "FLAT",
          discountValue: 0,
          itemDiscountTotalPaise: itemDiscountTotal,
          deliveryFeePaise,
          netTotalPaise: net + deliveryFeePaise,
          notes: isMockPaidDelivery
            ? `[TEST PAYMENT — not real money]${input.notes ? ` ${input.notes}` : ""}`
            : isRazorpayDelivery
              ? `[Paid via Razorpay — TEST MODE]${input.notes ? ` ${input.notes}` : ""}`
              : isCodDelivery
              ? `Cash on Delivery${input.notes ? ` — ${input.notes}` : ""}`
              : tableLabel
                ? `Table: ${tableLabel}${input.notes ? ` — ${input.notes}` : ""}`
                : input.notes ?? null,
          createdBy: null,
          confirmedAt: now,
          createdAt: now,
          updatedAt: now,
          clientIdempotencyKey: input.idempotencyKey ?? undefined,
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
        newValue: { orderNumber, subtotal, net, itemCount: resolvedItems.length, phone, orderType: input.orderType },
      },
      session
    );

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

function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 11000;
}

/** ₹0–99 → ₹40, ₹100–149 → ₹30, ₹150–199 → ₹20, ₹200+ → free. Computed server-side (never trusted from the client) since it directly affects the payable total. */
function deliveryFeeFor(subtotalPaise: number): number {
  if (subtotalPaise < 10000) return 4000;
  if (subtotalPaise < 15000) return 3000;
  if (subtotalPaise < 20000) return 2000;
  return 0;
}
