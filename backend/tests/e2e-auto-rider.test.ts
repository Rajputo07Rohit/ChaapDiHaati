import { describe, it, expect } from "vitest";

describe("Packing -> auto rider", () => {
  it("assignRider with no rider named picks the least-busy active rider", async () => {
    const { MenuCategory, MenuItem, User } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { assignRider } = await import("../src/modules/orders/orders.service");
    const { newId, nowIso } = await import("../src/utils/ids");
    const bcrypt = (await import("bcryptjs")).default;

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({ _id: itemId, categoryId: catId, name: "Dal", hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "plate", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
    await setMenuPrice(itemId, "SINGLE", 25000, "test-admin");

    // No riders yet -> clear error
    const mk = () =>
      createCustomerOrder(
        { orderType: "DELIVERY", customerName: "C", deliveryAddress: "1 St", paymentProvider: "COD", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] },
        "+919811111111"
      );
    const first = await mk();
    await expect(assignRider(first.id, undefined, "staff")).rejects.toThrow(/No active riders/);

    const rider = async (name: string) => {
      const id = newId("user");
      await User.create({ _id: id, username: name, passwordHash: bcrypt.hashSync("x", 4), fullName: name, role: "RIDER", active: true, createdAt: nowIso(), updatedAt: nowIso() });
      return id;
    };
    const a = await rider("riderA");
    const b = await rider("riderB");

    const o1 = await assignRider(first.id, undefined, "staff");
    expect(o1.status).toBe("OUT_FOR_DELIVERY");
    expect([a, b]).toContain(o1.assigned_rider_id);

    // Second order must go to the other rider (the first now has one open delivery)
    const o2 = await assignRider((await mk()).id, undefined, "staff");
    expect(o2.assigned_rider_id).not.toBe(o1.assigned_rider_id);
  });
});
