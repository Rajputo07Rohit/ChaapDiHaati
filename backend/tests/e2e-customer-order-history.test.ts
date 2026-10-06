import { describe, it, expect } from "vitest";

describe("Customer order history", () => {
  it("lists only the caller's own orders, newest first, and blocks viewing someone else's", async () => {
    const { app } = await import("../src/app");
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { issueCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const request = (await import("supertest")).default;

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Butter Chicken",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 20000, "test-admin");

    const phoneA = "+919811111111";
    const phoneB = "+919822222222";
    const tokenA = issueCustomerToken(phoneA);
    const tokenB = issueCustomerToken(phoneB);

    const orderA1 = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Customer A", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
      phoneA
    );
    const orderA2 = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Customer A", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 2 }] },
      phoneA
    );
    const orderB1 = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Customer B", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
      phoneB
    );

    // Customer A's history shows only their own 2 orders, newest first.
    const listA = await request(app).get("/api/public/orders").set("Authorization", `Bearer ${tokenA}`);
    expect(listA.status).toBe(200);
    const idsA = listA.body.orders.map((o: any) => o.id);
    expect(idsA).toEqual([orderA2.id, orderA1.id]);
    expect(idsA).not.toContain(orderB1.id);
    console.log("[OK] Customer A's history lists only their own orders, newest first");

    // Response shape leaks nothing internal.
    const leakedKeys = ["cogs_paise", "created_by", "customer_phone", "discount_reason"];
    for (const k of leakedKeys) expect(listA.body.orders[0]).not.toHaveProperty(k);
    console.log("[OK] History list entries carry no internal/other-customer fields");

    // Customer A can fetch their own order detail, with items.
    const detailA = await request(app).get(`/api/public/orders/${orderA2.id}`).set("Authorization", `Bearer ${tokenA}`);
    expect(detailA.status).toBe(200);
    expect(detailA.body.order.items).toHaveLength(1);
    expect(detailA.body.order.items[0].quantity).toBe(2);
    expect(detailA.body.order.items[0].name).toBe("Butter Chicken");
    console.log("[OK] Order detail includes sanitized items for the owning customer");

    // Customer B cannot fetch customer A's order by guessing/reusing the id.
    const idor = await request(app).get(`/api/public/orders/${orderA1.id}`).set("Authorization", `Bearer ${tokenB}`);
    expect(idor.status).toBe(403);
    console.log("[OK] A different customer is blocked (403) from viewing someone else's order detail");

    // No auth at all -> 401.
    const noAuth = await request(app).get("/api/public/orders");
    expect(noAuth.status).toBe(401);
    console.log("[OK] Order history requires auth (401 without a token)");
  }, 30_000);

  it("shows the cancellation/denial reason to the customer, but only for cancelled orders", async () => {
    const { app } = await import("../src/app");
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { issueCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { cancelOrder } = await import("../src/modules/orders/orders.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const request = (await import("supertest")).default;

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains (cancel reason test)", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Butter Chicken",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 20000, "test-admin");

    const phone = "+919833333333";
    const token = issueCustomerToken(phone);

    const active = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
      phone
    );
    const toCancel = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
      phone
    );
    await cancelOrder(toCancel.id, "Kitchen is closing early today", "staff-admin", "ADMIN");

    const list = await request(app).get("/api/public/orders").set("Authorization", `Bearer ${token}`);
    const activeEntry = list.body.orders.find((o: any) => o.id === active.id);
    const cancelledEntry = list.body.orders.find((o: any) => o.id === toCancel.id);
    expect(activeEntry.cancel_reason).toBeNull();
    expect(cancelledEntry.cancel_reason).toBe("Kitchen is closing early today");
    console.log("[OK] cancel_reason is null for an active order and populated for the cancelled one, in the history list");

    const detail = await request(app).get(`/api/public/orders/${toCancel.id}`).set("Authorization", `Bearer ${token}`);
    expect(detail.body.order.status).toBe("CANCELLED");
    expect(detail.body.order.cancel_reason).toBe("Kitchen is closing early today");
    console.log("[OK] cancel_reason also present on the order detail view");
  }, 30_000);
});
