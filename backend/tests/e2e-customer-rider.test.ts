import { describe, it, expect } from "vitest";

describe("Customer DELIVERY order -> rider visibility chain", () => {
  it("shows up for the rider only after assign + advance to OUT_FOR_DELIVERY", async () => {
    const { MenuCategory, MenuItem, User } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { issueCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { assignRider, updateOrderStatus, listOrdersForRider } = await import("../src/modules/orders/orders.service");
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
    expect(order.status).toBe("CONFIRMED");
    expect(order.assigned_rider_id).toBeNull();
    console.log("[OK] Customer DELIVERY order created: status=CONFIRMED, no rider assigned yet");

    // Not visible to the rider yet — correct, nothing assigned/dispatched.
    let riderQueue = await listOrdersForRider(riderId);
    expect(riderQueue.find((o) => o.id === order.id)).toBeUndefined();
    console.log("[OK] Not yet visible to rider (expected: unassigned, still CONFIRMED)");

    // Staff assigns a rider — order.status is still CONFIRMED.
    const afterAssign = await assignRider(order.id, riderId, "staff-admin");
    expect(afterAssign.assigned_rider_id).toBe(riderId);
    riderQueue = await listOrdersForRider(riderId);
    expect(riderQueue.find((o) => o.id === order.id)).toBeUndefined();
    console.log("[OK] Rider assigned, but STILL not in rider's default queue (queue defaults to status=OUT_FOR_DELIVERY only)");

    // Staff advances through the kitchen stages one at a time (enforced server-side).
    await updateOrderStatus(order.id, "PREPARING", "staff-admin");
    await updateOrderStatus(order.id, "READY", "staff-admin");
    const final = await updateOrderStatus(order.id, "OUT_FOR_DELIVERY", "staff-admin");
    expect(final.status).toBe("OUT_FOR_DELIVERY");

    riderQueue = await listOrdersForRider(riderId);
    const visible = riderQueue.find((o) => o.id === order.id);
    expect(visible).toBeDefined();
    expect(visible!.assigned_rider_id).toBe(riderId);
    console.log("[OK] NOW visible in rider's queue, after: assign rider -> PREPARING -> READY -> OUT_FOR_DELIVERY");
  }, 30_000);
});
