import { describe, it, expect } from "vitest";

describe("Customer DELIVERY order -> rider visibility chain", () => {
  it("one-click rider assignment accepts + dispatches a still-pending order directly", async () => {
    const { MenuCategory, MenuItem, User } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { issueCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { assignRider, listOrdersForRider } = await import("../src/modules/orders/orders.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const bcrypt = (await import("bcryptjs")).default;

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Butter Chicken",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 25000, "test-admin");

    const riderId = newId("user");
    await User.create({
      _id: riderId, username: "rider1", passwordHash: bcrypt.hashSync("x", 4),
      fullName: "Test Rider", role: "RIDER", active: true, createdAt: nowIso(), updatedAt: nowIso(),
    });

    const phone = "+919876543210";
    issueCustomerToken(phone); // just exercising the real path a customer would use

    const order = await createCustomerOrder(
      {
        orderType: "DELIVERY",
        customerName: "Test Customer",
        deliveryAddress: "123 Test St",
        deliveryLatitude: 28.6,
        deliveryLongitude: 77.2,
        paymentProvider: "COD",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      },
      phone
    );
    expect(order.status).toBe("PENDING_ACCEPTANCE");
    expect(order.assigned_rider_id).toBeNull();
    console.log("[OK] Customer DELIVERY order created: status=PENDING_ACCEPTANCE, no rider assigned yet");

    // Not visible to the rider yet — correct, nothing assigned/dispatched.
    let riderQueue = await listOrdersForRider(riderId);
    expect(riderQueue.find((o) => o.id === order.id)).toBeUndefined();
    console.log("[OK] Not yet visible to rider (expected: unassigned)");

    // Staff picks a rider straight from PENDING_ACCEPTANCE — a single call,
    // no separate accept/prepare/ready/dispatch clicks.
    const assigned = await assignRider(order.id, riderId, "staff-admin");
    expect(assigned.status).toBe("OUT_FOR_DELIVERY");
    expect(assigned.assigned_rider_id).toBe(riderId);
    console.log("[OK] assignRider on a PENDING_ACCEPTANCE order jumps straight to OUT_FOR_DELIVERY in one call");

    riderQueue = await listOrdersForRider(riderId);
    const visible = riderQueue.find((o) => o.id === order.id);
    expect(visible).toBeDefined();
    expect(visible!.assigned_rider_id).toBe(riderId);
    console.log("[OK] Immediately visible in rider's queue after the single assign-rider call");
  }, 30_000);

  it("one-click rider assignment also dispatches an already-accepted (CONFIRMED) order", async () => {
    const { MenuCategory, MenuItem, User } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { assignRider, acceptOrder, listOrdersForRider } = await import("../src/modules/orders/orders.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const bcrypt = (await import("bcryptjs")).default;

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains2", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Paneer Tikka",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 18000, "test-admin");

    const riderId = newId("user");
    await User.create({
      _id: riderId, username: "rider2", passwordHash: bcrypt.hashSync("x", 4),
      fullName: "Test Rider 2", role: "RIDER", active: true, createdAt: nowIso(), updatedAt: nowIso(),
    });

    const order = await createCustomerOrder(
      {
        orderType: "DELIVERY",
        customerName: "Another Customer",
        deliveryAddress: "456 Test Ave",
        paymentProvider: "COD",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      },
      "+919812300000"
    );

    // Staff accepts first (without picking a rider yet) — still a valid path.
    const accepted = await acceptOrder(order.id, "staff-admin");
    expect(accepted.status).toBe("CONFIRMED");

    const assigned = await assignRider(order.id, riderId, "staff-admin");
    expect(assigned.status).toBe("OUT_FOR_DELIVERY");
    expect(assigned.assigned_rider_id).toBe(riderId);

    const riderQueue = await listOrdersForRider(riderId);
    expect(riderQueue.find((o) => o.id === order.id)).toBeDefined();
    console.log("[OK] assignRider on an already-CONFIRMED order also dispatches it straight away");
  }, 30_000);

  it("accept/deny guard rails, and add-on pricing", async () => {
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    const { setMenuPrice, setMenuItemAddons, getMenuItemOrThrow } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { acceptOrder, cancelOrder } = await import("../src/modules/orders/orders.service");
    const { newId, nowIso } = await import("../src/utils/ids");

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Rolls", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Egg Roll",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 8000, "test-admin"); // ₹80
    await setMenuItemAddons(itemId, [{ name: "Extra Cheese", pricePaise: 2000 }]); // ₹20
    const menuItem = await getMenuItemOrThrow(itemId);
    const addonId = menuItem.addons[0].id;

    const phone = "+919812345678";

    // Deny before accept: allowed, and does NOT auto-refund (reason required, no gateway call).
    const toDeny = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1, addonIds: [addonId] }] },
      phone
    );
    expect(toDeny.status).toBe("PENDING_ACCEPTANCE");
    expect(toDeny.net_total_paise).toBe(10000); // ₹80 + ₹20 addon
    console.log("[OK] Add-on priced correctly into the order total (₹80 item + ₹20 Extra Cheese = ₹100)");

    const denied = await cancelOrder(toDeny.id, "Kitchen too busy right now", "staff-admin", "ADMIN");
    expect(denied.status).toBe("CANCELLED");
    console.log("[OK] Deny (cancelOrder on a PENDING_ACCEPTANCE order) succeeds, reason required");

    // Can't accept an order that isn't PENDING_ACCEPTANCE (e.g. already cancelled).
    await expect(acceptOrder(toDeny.id, "staff-admin")).rejects.toThrow();
    console.log("[OK] Cannot accept an order that's already been denied/cancelled");

    // Can't accept the same order twice.
    const toAccept = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
      phone
    );
    await acceptOrder(toAccept.id, "staff-admin");
    await expect(acceptOrder(toAccept.id, "staff-admin")).rejects.toThrow();
    console.log("[OK] Cannot accept an already-accepted (CONFIRMED) order again");
  }, 30_000);
});
