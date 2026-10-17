import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "crypto";

afterEach(() => vi.unstubAllGlobals());

/** A tiny fake of Cashfree's orders + refunds API. */
function fakeCashfree() {
  const orders = new Map<string, any>();
  const refunds = new Map<string, any>();
  let refundsDown = false;
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b });
    if (init.method === "POST" && url.endsWith("/pg/orders")) {
      const b = JSON.parse(init.body);
      const rec = { ...b, cf_order_id: 1, order_status: "ACTIVE", payment_session_id: `sess_${b.order_id}` };
      orders.set(b.order_id, rec);
      return json(rec);
    }
    const refundMatch = url.match(/\/pg\/orders\/([^/]+)\/refunds(?:\/([^/]+))?$/);
    if (refundMatch) {
      if (refundsDown) return json({ message: "service unavailable" }, 503);
      const orderId = decodeURIComponent(refundMatch[1]);
      if (init.method === "POST") {
        const b = JSON.parse(init.body);
        if (refunds.has(b.refund_id)) return json({ message: "refund_id already exists" }, 409);
        const rec = { refund_id: b.refund_id, order_id: orderId, refund_amount: b.refund_amount, refund_status: "PENDING" };
        refunds.set(b.refund_id, rec);
        return json(rec);
      }
      const rec = refunds.get(decodeURIComponent(refundMatch[2]));
      return rec ? json(rec) : json({ message: "refund not found" }, 404);
    }
    const id = decodeURIComponent(url.split("/pg/orders/")[1]);
    if (init.method === "PATCH" && orders.has(id)) {
      const rec = orders.get(id);
      if (rec.order_status === "PAID") return json({ message: "order already paid" }, 409);
      rec.order_status = "TERMINATED";
      return json(rec);
    }
    return orders.has(id) ? json(orders.get(id)) : json({ message: "order not found" }, 404);
  });
  return { orders, refunds, setRefundsDown: (v: boolean) => (refundsDown = v) };
}

async function setup() {
  const { env } = await import("../src/config/env");
  env.cashfreeAppId = "TEST_APP_ID";
  env.cashfreeSecretKey = "cfsk_test_secret";
  const cf = fakeCashfree();

  const { MenuCategory, MenuItem } = await import("../src/db/models");
  const { setMenuPrice } = await import("../src/modules/menu/menu.service");
  const { newId, nowIso } = await import("../src/utils/ids");
  const catId = newId("cat");
  await MenuCategory.create({ _id: catId, name: `Mains ${catId}`, sortOrder: 0, active: true });
  const itemId = newId("menuitem");
  await MenuItem.create({ _id: itemId, categoryId: catId, name: "Malai Chaap", hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "plate", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
  await setMenuPrice(itemId, "SINGLE", 25000, "test-admin"); // ₹250 -> free delivery
  return { cf, itemId, newId };
}

const order = (itemId: string, extra: Record<string, unknown> = {}) => ({
  orderType: "DELIVERY" as const,
  customerName: "Asha",
  deliveryAddress: "12 Model Town",
  items: [{ menuItemId: itemId, priceType: "SINGLE" as const, quantity: 1 }],
  ...extra,
});

describe("Online payments never leave a customer out of pocket", () => {
  it("a paid order that's denied is refunded automatically, and a failed refund is retried", async () => {
    const { cf, itemId, newId } = await setup();
    const svc = await import("../src/modules/customerOrders/customerOrders.service");
    const { cancelOrder } = await import("../src/modules/orders/orders.service");
    const { syncGatewayRefunds, retryGatewayRefund } = await import("../src/modules/payments/refunds.service");
    const { Order } = await import("../src/db/models");
    const phone = "+919811100001";

    const co = await svc.createCashfreeCheckout(order(itemId), phone);
    cf.orders.get(co.cashfreeOrderId).order_status = "PAID";
    const placed = await svc.createCustomerOrder({ ...order(itemId), paymentProvider: "CASHFREE", cashfreeOrderId: co.cashfreeOrderId, idempotencyKey: newId("k") }, phone);

    // The online payment is in the books: a payment line, a bank credit, and not "unpaid" in the day summary.
    const { BankTransaction } = await import("../src/db/models");
    const { getDaySummary } = await import("../src/modules/orders/orders.service");
    const paidDoc = (await Order.findById(placed.id))!;
    expect(paidDoc.payments).toHaveLength(1);
    expect(paidDoc.payments[0]).toMatchObject({ amountPaise: 25000, reference: co.cashfreeOrderId, status: "ACTIVE" });
    const credit = await BankTransaction.findOne({ reference: co.cashfreeOrderId, txnType: "CREDIT" });
    expect(credit?.amountPaise).toBe(25000);
    await Order.updateOne({ _id: placed.id }, { status: "CONFIRMED" }); // accepted, so it counts as a sale
    const summary = await getDaySummary(paidDoc.businessDate);
    expect(summary.online_paise).toBeGreaterThanOrEqual(25000);
    expect(summary.unpaid_paise).toBe(0);

    const denied = await cancelOrder(placed.id, "Out of stock", "test-admin", "ADMIN");
    // ...and cancelling reverses it in the books as well as refunding at Cashfree.
    expect((await Order.findById(placed.id))!.payments[0].status).toBe("VOIDED");
    expect(await BankTransaction.countDocuments({ txnType: "DEBIT", amountPaise: 25000, description: new RegExp(`#${paidDoc.orderNumber}\\b`) })).toBe(1);
    expect(denied.status).toBe("CANCELLED");
    expect(denied.payment_status).toBe("REFUNDED");
    expect(denied.refund_status).toBe("PENDING");
    const [refund] = [...cf.refunds.values()];
    expect(refund.order_id).toBe(co.cashfreeOrderId);
    expect(refund.refund_amount).toBe(250);

    // Cashfree finishes it -> the sweep picks it up
    refund.refund_status = "SUCCESS";
    await syncGatewayRefunds();
    expect((await Order.findById(placed.id))!.refundStatus).toBe("SUCCESS");

    // A second order whose refund call fails (gateway down) is marked FAILED, then retried
    const co2 = await svc.createCashfreeCheckout(order(itemId), phone);
    cf.orders.get(co2.cashfreeOrderId).order_status = "PAID";
    const placed2 = await svc.createCustomerOrder({ ...order(itemId), paymentProvider: "CASHFREE", cashfreeOrderId: co2.cashfreeOrderId, idempotencyKey: newId("k") }, phone);
    cf.setRefundsDown(true);
    expect((await cancelOrder(placed2.id, "Kitchen closed", "test-admin", "ADMIN")).refund_status).toBe("FAILED");
    cf.setRefundsDown(false);
    await retryGatewayRefund(placed2.id, "test-admin");
    expect((await Order.findById(placed2.id))!.refundStatus).toBe("PENDING");
    // retrying again can never refund twice (same refund id)
    await retryGatewayRefund(placed2.id, "test-admin");
    expect([...cf.refunds.values()].filter((r) => r.order_id === co2.cashfreeOrderId)).toHaveLength(1);

    // A COD order that's cancelled has nothing to refund
    const cod = await svc.createCustomerOrder({ ...order(itemId), paymentProvider: "COD", idempotencyKey: newId("k") }, phone);
    const codCancelled = await cancelOrder(cod.id, "Customer asked", "test-admin", "ADMIN");
    expect(codCancelled.refund_status).toBeNull();
    expect(codCancelled.payment_status).toBe("UNPAID");
  });

  it("a payment whose browser never came back becomes an order via the webhook — or is refunded", async () => {
    const { cf, itemId } = await setup();
    const { app } = await import("../src/app");
    const request = (await import("supertest")).default;
    const svc = await import("../src/modules/customerOrders/customerOrders.service");
    const { CheckoutSession, MenuItem, Order } = await import("../src/db/models");
    const phone = "+919811100002";

    // 1. customer pays, then their phone dies — only the webhook arrives
    const co = await svc.createCashfreeCheckout(order(itemId, { notes: "less spicy" }), phone);
    cf.orders.get(co.cashfreeOrderId).order_status = "PAID";
    const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: co.cashfreeOrderId } } });
    const ts = String(Date.now());
    const sig = crypto.createHmac("sha256", "cfsk_test_secret").update(ts + body).digest("base64");

    // a forged webhook is ignored
    await request(app).post("/api/public/payments/cashfree/webhook").set("x-webhook-timestamp", ts).set("x-webhook-signature", "forged").set("Content-Type", "application/json").send(body).expect(401);
    expect(await Order.countDocuments({ paymentRef: co.cashfreeOrderId })).toBe(0);

    await request(app).post("/api/public/payments/cashfree/webhook").set("x-webhook-timestamp", ts).set("x-webhook-signature", sig).set("Content-Type", "application/json").send(body).expect(200);
    const created = await Order.findOne({ paymentRef: co.cashfreeOrderId });
    expect(created).toBeTruthy();
    expect(created!.paymentStatus).toBe("PAID");
    expect(created!.customerName).toBe("Asha");
    expect(created!.deliveryAddress).toBe("12 Model Town");
    expect((await CheckoutSession.findById(co.cashfreeOrderId))!.status).toBe("COMPLETED");

    // the app coming back later gets that same order, not an error and not a second order
    const again = await svc.createCustomerOrder({ ...order(itemId, { notes: "less spicy" }), paymentProvider: "CASHFREE", cashfreeOrderId: co.cashfreeOrderId }, phone);
    expect(again.id).toBe(created!._id);
    expect(await Order.countDocuments({ paymentRef: co.cashfreeOrderId })).toBe(1);

    // 2. paid, but by the time we reconcile the item has gone unavailable -> full refund
    const co2 = await svc.createCashfreeCheckout(order(itemId), phone);
    cf.orders.get(co2.cashfreeOrderId).order_status = "PAID";
    await MenuItem.updateOne({ _id: itemId }, { status: "UNAVAILABLE" });
    await svc.reconcileCheckout(co2.cashfreeOrderId);
    await MenuItem.updateOne({ _id: itemId }, { status: "ACTIVE" });
    const s2 = await CheckoutSession.findById(co2.cashfreeOrderId);
    expect(s2!.status).toBe("REFUNDED");
    expect([...cf.refunds.values()].find((r) => r.order_id === co2.cashfreeOrderId)?.refund_amount).toBe(250);
    expect(await Order.countDocuments({ paymentRef: co2.cashfreeOrderId })).toBe(0);
    expect((await svc.listProblemCheckouts()).some((c) => c.id === co2.cashfreeOrderId)).toBe(true);

    // 3. never paid and the window is long over -> closed at Cashfree so it can't be paid later
    const co3 = await svc.createCashfreeCheckout(order(itemId), phone);
    await CheckoutSession.updateOne({ _id: co3.cashfreeOrderId }, { createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
    await svc.reconcileStaleCheckouts();
    expect(cf.orders.get(co3.cashfreeOrderId).order_status).toBe("TERMINATED");
    expect((await CheckoutSession.findById(co3.cashfreeOrderId))!.status).toBe("CANCELLED");

    // 4. the checkout checks name/address before taking any money
    await expect(svc.createCashfreeCheckout(order(itemId, { deliveryAddress: "  " }), phone)).rejects.toThrow(/delivery address/);
  });

  it("remembers the customer's name and addresses, and takes one private rating per finished order", async () => {
    const { itemId, newId } = await setup();
    const svc = await import("../src/modules/customerOrders/customerOrders.service");
    const { Order } = await import("../src/db/models");
    const phone = "+919811100003";

    const o1 = await svc.createCustomerOrder({ ...order(itemId), paymentProvider: "COD", idempotencyKey: newId("k") }, phone);
    await svc.createCustomerOrder({ ...order(itemId, { deliveryAddress: "7 Civil Lines", deliveryLatitude: 30.9, deliveryLongitude: 75.8 }), paymentProvider: "COD", idempotencyKey: newId("k") }, phone);
    await svc.createCustomerOrder({ ...order(itemId, { deliveryAddress: "12  model town" }), paymentProvider: "COD", idempotencyKey: newId("k") }, phone);
    const profile = await svc.getCustomerProfile(phone);
    expect(profile.name).toBe("Asha");
    expect(profile.addresses.map((a) => a.address)).toEqual(["12 Model Town", "7 Civil Lines"]); // de-duplicated, most recent first
    expect(profile.addresses[1].latitude).toBe(30.9);

    await expect(svc.submitOrderFeedback(o1.id, phone, 5, "Great")).rejects.toThrow(/once it's done/);
    await Order.updateOne({ _id: o1.id }, { status: "COMPLETED" });
    await expect(svc.submitOrderFeedback(o1.id, "+919811100009", 5, null)).rejects.toThrow(/isn't yours/);
    await svc.submitOrderFeedback(o1.id, phone, 4, "Tasty but late");
    await expect(svc.submitOrderFeedback(o1.id, phone, 1, null)).rejects.toThrow(/already rated/);
    const list = await svc.listFeedback();
    expect(list.feedback.find((f) => f.order_id === o1.id)).toMatchObject({ rating: 4, comment: "Tasty but late", customer_name: "Asha" });
  });
});
