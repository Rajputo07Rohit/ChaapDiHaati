import { describe, it, expect } from "vitest";

describe("Stall ordering", () => {
  it("serves only the stall menu and the enabled stall order types while stall mode is on", async () => {
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { listPublicMenu } = await import("../src/modules/customerMenu/customerMenu.service");
    const { saveStallMode } = await import("../src/modules/storeStatus/storeStatus.service");
    const { newId, nowIso } = await import("../src/utils/ids");

    const mainCat = newId("cat");
    await MenuCategory.create({ _id: mainCat, name: "Soya Tandoori", sortOrder: 0, active: true });
    const stallCat = newId("cat");
    await MenuCategory.create({ _id: stallCat, name: "Stall · Soya Tandoori", sortOrder: 1000, active: true, channel: "STALL" });
    const mk = async (name: string, price: number, cat: string) => {
      const id = newId("menuitem");
      await MenuItem.create({ _id: id, categoryId: cat, name, hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "portion", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
      await setMenuPrice(id, "SINGLE", price, "test-admin");
      return id;
    };
    const mainChaap = await mk("Malai Chaap", 18000, mainCat);
    const stallChaap = await mk("Malai Chaap", 13000, stallCat);
    const phone = "+919800033333";
    const order = (orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY", id: string) =>
      createCustomerOrder(
        { orderType, customerName: "S", deliveryAddress: "Sector 5", paymentProvider: "COD", items: [{ menuItemId: id, priceType: "SINGLE", quantity: 1 }] },
        phone
      );

    // Customers see the stall category without its "Stall · " prefix.
    const menu = await listPublicMenu();
    expect(menu.find((c) => c.id === stallCat)).toMatchObject({ name: "Soya Tandoori", channel: "STALL" });

    // Stall off: restaurant menu only.
    await expect(order("TAKEAWAY", stallChaap)).rejects.toThrow(/stall menu isn't available/i);
    expect((await order("TAKEAWAY", mainChaap)).channel).toBe("MAIN");

    // Stall dine-in on: stall items, dine-in only.
    await saveStallMode({ dineIn: true, delivery: false }, "test-admin");
    await expect(order("DINE_IN", mainChaap)).rejects.toThrow(/order from the stall menu/i);
    await expect(order("DELIVERY", stallChaap)).rejects.toThrow(/dine-in only/i);
    await expect(order("TAKEAWAY", stallChaap)).rejects.toThrow(/dine-in only/i);
    const dineIn = await order("DINE_IN", stallChaap);
    expect(dineIn.channel).toBe("STALL");
    expect(dineIn.net_total_paise).toBe(13000);

    // Stall delivery on as well.
    await saveStallMode({ dineIn: true, delivery: true }, "test-admin");
    const delivery = await order("DELIVERY", stallChaap);
    expect(delivery.channel).toBe("STALL");
    expect(delivery.packing_fee_paise).toBe(0);

    await saveStallMode({ dineIn: false, delivery: false }, "test-admin");
  });

  it("stall dine-in is prepaid: staff confirm the payment, which records it and sends the order to the kitchen", async () => {
    const { MenuCategory, MenuItem, Order } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { acceptOrder, confirmPrepayment, expireStalePendingOrders } = await import("../src/modules/orders/orders.service");
    const { saveStallMode } = await import("../src/modules/storeStatus/storeStatus.service");
    const { makePaymentMethod, makeUser } = await import("./fixtures");
    const { newId, nowIso } = await import("../src/utils/ids");

    const staff = await makeUser("STAFF");
    const cash = await makePaymentMethod("CASH");
    const stallCat = newId("cat");
    await MenuCategory.create({ _id: stallCat, name: "Stall · Paneer Tandoori", sortOrder: 1001, active: true, channel: "STALL" });
    const tikka = newId("menuitem");
    await MenuItem.create({ _id: tikka, categoryId: stallCat, name: "Paneer Tikka", hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "portion", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
    await setMenuPrice(tikka, "SINGLE", 21000, "test-admin");
    await saveStallMode({ dineIn: true, delivery: true }, "test-admin");

    const place = (orderType: "DINE_IN" | "DELIVERY") =>
      createCustomerOrder(
        { orderType, customerName: "P", deliveryAddress: "Sector 5", paymentProvider: "COD", items: [{ menuItemId: tikka, priceType: "SINGLE", quantity: 1 }] },
        "+919800044444"
      );

    // Stall delivery is not prepaid; stall dine-in is.
    expect((await place("DELIVERY")).prepayment_required).toBe(false);
    const order = await place("DINE_IN");
    expect(order.prepayment_required).toBe(true);
    expect(order.status).toBe("PENDING_ACCEPTANCE");

    // Can't skip the payment, or pay only part of it.
    await expect(acceptOrder(order.id, staff)).rejects.toThrow(/confirm the customer's payment first/i);
    await expect(confirmPrepayment(order.id, [{ paymentMethodId: cash, amountPaise: 10000 }], staff)).rejects.toThrow(/paid in full/i);

    const confirmed = await confirmPrepayment(order.id, [{ paymentMethodId: cash, amountPaise: 21000 }], staff, 15);
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.payment_status).toBe("PAID");
    expect(confirmed.prep_time_minutes).toBe(15);
    // A second tap doesn't post the payment twice.
    await expect(confirmPrepayment(order.id, [{ paymentMethodId: cash, amountPaise: 21000 }], staff)).rejects.toThrow(/already confirmed/i);
    expect((await Order.findById(order.id))!.payments).toHaveLength(1);

    // An unpaid prepaid order gets 15 minutes (not 5) before it's cancelled.
    const unpaid = await place("DINE_IN");
    await Order.updateOne({ _id: unpaid.id }, { createdAt: new Date(Date.now() - 10 * 60_000).toISOString() });
    await expireStalePendingOrders(5);
    expect((await Order.findById(unpaid.id))!.status).toBe("PENDING_ACCEPTANCE");
    await Order.updateOne({ _id: unpaid.id }, { createdAt: new Date(Date.now() - 16 * 60_000).toISOString() });
    await expireStalePendingOrders(5);
    const expired = (await Order.findById(unpaid.id))!;
    expect(expired.status).toBe("CANCELLED");
    expect(expired.cancelReason).toMatch(/payment wasn't received/i);

    await saveStallMode({ dineIn: false, delivery: false }, "test-admin");
  });
});
