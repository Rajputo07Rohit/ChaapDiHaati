import { describe, it, expect, vi } from "vitest";

const sent: { endpoint: string; payload: any }[] = [];
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.includes("gone")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
    },
  },
}));

const settle = () => new Promise((r) => setTimeout(r, 150));

describe("Customer order notifications", () => {
  it("pushes accept / cancel updates to the ordering customer only, and drops dead subscriptions", async () => {
    const { env } = await import("../src/config/env");
    env.vapidPublicKey = "test-public";
    env.vapidPrivateKey = "test-private";

    const { MenuCategory, MenuItem, PushSubscription } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const { savePushSubscription } = await import("../src/modules/notifications/notify.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { acceptOrder, cancelOrder, createOrder } = await import("../src/modules/orders/orders.service");

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Rolls", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({ _id: itemId, categoryId: catId, name: "Chaap Roll", hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "pc", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
    await setMenuPrice(itemId, "SINGLE", 12000, "test-admin");

    const phone = "+919822200001";
    await savePushSubscription(phone, { endpoint: "https://push.example/alive", keys: { p256dh: "k", auth: "a" } });
    await savePushSubscription(phone, { endpoint: "https://push.example/gone", keys: { p256dh: "k", auth: "a" } });
    await savePushSubscription("+919822200002", { endpoint: "https://push.example/someone-else", keys: { p256dh: "k", auth: "a" } });

    const items = [{ menuItemId: itemId, priceType: "SINGLE" as const, quantity: 1 }];
    const o = await createCustomerOrder({ orderType: "TAKEAWAY", customerName: "Ravi", items, idempotencyKey: newId("k") }, phone);
    await acceptOrder(o.id, "test-admin", 15);
    await settle();
    expect(sent).toHaveLength(1);
    expect(sent[0].endpoint).toBe("https://push.example/alive");
    expect(sent[0].payload.title).toMatch(/accepted/);
    expect(sent[0].payload.body).toMatch(/15 min/);
    expect(sent[0].payload.url).toBe(`/order/${o.id}`);
    expect(await PushSubscription.exists({ _id: "https://push.example/gone" })).toBeNull();

    await cancelOrder(o.id, "Ran out of chaap", "test-admin", "ADMIN");
    await settle();
    expect(sent[1].payload.title).toMatch(/cancelled/);
    expect(sent[1].payload.body).toMatch(/Ran out of chaap/);

    // An order staff rang up at the counter (even with a phone typed in) never notifies anyone.
    const staffOrder = await createOrder({ orderType: "TAKEAWAY", customerPhone: phone, items }, "test-admin", "ADMIN");
    await cancelOrder(staffOrder.id, "Mistake", "test-admin", "ADMIN");
    await settle();
    expect(sent).toHaveLength(2);
  });
});
