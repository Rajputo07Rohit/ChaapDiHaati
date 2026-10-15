import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("Cashfree online payment", () => {
  it("creates a checkout, only accepts a verified PAID order, and refuses reuse / wrong amount / wrong phone", async () => {
    const { env } = await import("../src/config/env");
    env.cashfreeAppId = "TEST_APP_ID";
    env.cashfreeSecretKey = "cfsk_test_secret";

    // --- a tiny fake of Cashfree's API ---
    const store = new Map<string, any>();
    const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, method: init.method, headers: init.headers });
      const json = (b: unknown, status = 200) => ({ ok: status < 400, status, json: async () => b });
      if (init.method === "POST" && url.endsWith("/pg/orders")) {
        const b = JSON.parse(init.body);
        const rec = { ...b, cf_order_id: 1, order_status: "ACTIVE", payment_session_id: `sess_${b.order_id}` };
        store.set(b.order_id, rec);
        return json(rec);
      }
      const id = decodeURIComponent(url.split("/pg/orders/")[1]);
      if (init.method === "PATCH" && store.has(id)) {
        const rec = store.get(id);
        if (rec.order_status === "PAID") return json({ message: "order already paid" }, 409);
        rec.order_status = "TERMINATED";
        return json(rec);
      }
      return store.has(id) ? json(store.get(id)) : json({ message: "order not found" }, 404);
    });

    const { MenuCategory, MenuItem, Order } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCashfreeCheckout, createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { newId, nowIso } = await import("../src/utils/ids");

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({ _id: itemId, categoryId: catId, name: "Butter Chicken", hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "plate", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
    await setMenuPrice(itemId, "SINGLE", 25000, "test-admin"); // ₹250 -> free delivery

    const phone = "+919876500001";
    const cart = (qty: number) => [{ menuItemId: itemId, priceType: "SINGLE" as const, quantity: qty }];
    const place = (cashfreeOrderId: string, qty = 1, who = phone, key = newId("idem")) =>
      createCustomerOrder(
        { orderType: "DELIVERY", customerName: "Tester", deliveryAddress: "1 Test Road", paymentProvider: "CASHFREE", cashfreeOrderId, items: cart(qty), idempotencyKey: key },
        who
      );

    // 1. checkout is priced server-side and sent to the sandbox with credentials
    const co = await createCashfreeCheckout({ orderType: "DELIVERY", items: cart(1) }, phone);
    expect(co.amountPaise).toBe(25000);
    expect(co.paymentSessionId).toBe(`sess_${co.cashfreeOrderId}`);
    expect(co.mode).toBe("sandbox");
    expect(co.windowSeconds).toBe(300); // 5 minutes to pay
    // gateway-side expiry is only a >15-minute cleanup backstop (Cashfree's minimum)
    expect(new Date(store.get(co.cashfreeOrderId).order_expiry_time).getTime() - Date.now()).toBeGreaterThan(15 * 60_000);
    expect(calls[0].url).toBe("https://sandbox.cashfree.com/pg/orders");
    expect(calls[0].headers["x-client-id"]).toBe("TEST_APP_ID");
    expect(store.get(co.cashfreeOrderId).order_amount).toBe(250);
    // UPI only — no cards, netbanking, wallets, EMI, pay-later
    expect(store.get(co.cashfreeOrderId).order_meta.payment_methods).toBe("upi");
    expect(store.get(co.cashfreeOrderId).customer_details.customer_phone).toBe("9876500001");

    // 2. not paid yet -> no order
    await expect(place(co.cashfreeOrderId)).rejects.toThrow(/wasn't completed/);
    expect(await Order.countDocuments({ paymentRef: co.cashfreeOrderId })).toBe(0);

    // 3. wrong amount: customer pays for 1 plate, then submits a cart of 2
    store.get(co.cashfreeOrderId).order_status = "PAID";
    await expect(place(co.cashfreeOrderId, 2)).rejects.toThrow(/doesn't match/);

    // 4. wrong phone
    await expect(place(co.cashfreeOrderId, 1, "+919876500002")).rejects.toThrow(/different number/);

    // 5. paid + matching -> order created, marked PAID, payment ref stored
    const order = await place(co.cashfreeOrderId);
    expect(order.payment_status).toBe("PAID");
    expect(order.status).toBe("PENDING_ACCEPTANCE");
    expect(order.net_total_paise).toBe(25000);
    expect((await Order.findById(order.id))!.paymentRef).toBe(co.cashfreeOrderId);

    // 6. the same payment can't buy a second order
    await expect(place(co.cashfreeOrderId)).rejects.toThrow(/already been used/);

    // 7. an unknown / expired payment is rejected
    store.set("cf_expired", { order_id: "cf_expired", order_amount: 250, order_status: "EXPIRED" });
    await expect(place("cf_expired")).rejects.toThrow(/expired or failed/);

    // 8. the 5-minute window: an unpaid payment is terminated so it can't be paid later...
    const { cancelCashfreeCheckout } = await import("../src/modules/customerOrders/customerOrders.service");
    const late = await createCashfreeCheckout({ orderType: "DELIVERY", items: cart(1) }, phone);
    await expect(cancelCashfreeCheckout(late.cashfreeOrderId, "+919876500002")).rejects.toThrow(/isn't yours/);
    expect(await cancelCashfreeCheckout(late.cashfreeOrderId, phone)).toEqual({ paid: false });
    expect(store.get(late.cashfreeOrderId).order_status).toBe("TERMINATED");
    await expect(place(late.cashfreeOrderId)).rejects.toThrow(/expired or failed/);

    // ...but a payment that landed at the last second is honoured, not thrown away
    const lastSecond = await createCashfreeCheckout({ orderType: "DELIVERY", items: cart(1) }, phone);
    store.get(lastSecond.cashfreeOrderId).order_status = "PAID";
    expect(await cancelCashfreeCheckout(lastSecond.cashfreeOrderId, phone)).toEqual({ paid: true });
    expect((await place(lastSecond.cashfreeOrderId)).payment_status).toBe("PAID");
  });
});
