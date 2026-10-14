import { describe, it, expect } from "vitest";

describe("Store hours & rumali rule", () => {
  it("computes open/closed from schedule (incl. overnight) and manual overrides", async () => {
    const { computeStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    const base = { mode: "AUTO" as const, openTime: "11:00", closeTime: "23:00", closedMessage: "" };
    // 12:00 IST = 06:30 UTC
    expect(computeStoreStatus(base, new Date("2026-10-14T06:30:00Z")).isOpen).toBe(true);
    // 23:30 IST = 18:00 UTC
    const closed = computeStoreStatus(base, new Date("2026-10-14T18:00:00Z"));
    expect(closed.isOpen).toBe(false);
    expect(closed.message).toMatch(/11:00/);
    // overnight 18:00–02:00, at 01:00 IST (19:30 UTC prev day)
    const night = { ...base, openTime: "18:00", closeTime: "02:00" };
    expect(computeStoreStatus(night, new Date("2026-10-13T19:30:00Z")).isOpen).toBe(true);
    expect(computeStoreStatus(night, new Date("2026-10-14T06:30:00Z")).isOpen).toBe(false);
    // overrides beat the schedule
    expect(computeStoreStatus({ ...base, mode: "CLOSED" }, new Date("2026-10-14T06:30:00Z")).isOpen).toBe(false);
    expect(computeStoreStatus({ ...base, mode: "OPEN" }, new Date("2026-10-14T18:00:00Z")).isOpen).toBe(true);
    // default 00:00–00:00 = always open
    expect(computeStoreStatus({ ...base, openTime: "00:00", closeTime: "00:00" }, new Date("2026-10-14T18:00:00Z")).isOpen).toBe(true);
  });

  it("blocks customer orders when closed, and rumali-only orders", async () => {
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { saveStoreHours } = await import("../src/modules/storeStatus/storeStatus.service");
    const { newId, nowIso } = await import("../src/utils/ids");

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Paneer Tandoori", sortOrder: 0, active: true });
    const extrasCat = newId("cat");
    await MenuCategory.create({ _id: extrasCat, name: "Extras", sortOrder: 1, active: true });
    const mk = async (name: string, price: number, cat = catId) => {
      const id = newId("menuitem");
      await MenuItem.create({ _id: id, categoryId: cat, name, hasHalf: false, hasFull: false, hasSingle: true, unitLabel: "plate", halfLabel: "Half", fullLabel: "Full", status: "ACTIVE", createdAt: nowIso() });
      await setMenuPrice(id, "SINGLE", price, "test-admin");
      return id;
    };
    const rumali = await mk("Rumali Roti", 2000);
    const curry = await mk("Dal Makhani", 15000);
    const cream = await mk("Extra Cream", 1000, extrasCat);
    const phone = "+919800022222";
    const line = (id: string) => ({ menuItemId: id, priceType: "SINGLE" as const, quantity: 1 });
    const order = (ids: string[]) => createCustomerOrder({ orderType: "TAKEAWAY", customerName: "T", items: ids.map(line) }, phone);

    await expect(order([rumali])).rejects.toThrow(/rumali/i);
    await expect(order([rumali, cream])).rejects.toThrow(/rumali/i); // extras don't unlock rumali
    await expect(order([cream])).resolves.toBeDefined(); // extras alone are fine
    await expect(order([rumali, curry])).resolves.toBeDefined();

    await saveStoreHours({ mode: "CLOSED", openTime: "00:00", closeTime: "00:00", closedMessage: "Out of stock today" }, "test-admin");
    await expect(order([curry])).rejects.toThrow(/Out of stock today/);

    await saveStoreHours({ mode: "AUTO", openTime: "00:00", closeTime: "00:00", closedMessage: "" }, "test-admin");
    await expect(order([curry])).resolves.toBeDefined();
  });
});
