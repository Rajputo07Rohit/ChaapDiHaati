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
    expect(closed.message).toMatch(/11 AM/);
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

describe("Store status countdown", () => {
  it("reports seconds until the schedule flips", async () => {
    const { computeStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    const base = { mode: "AUTO" as const, openTime: "11:00", closeTime: "23:00", closedMessage: "" };
    // 22:00 IST (16:30 UTC) -> closes in 1h
    expect(computeStoreStatus(base, new Date("2026-10-14T16:30:00Z")).changesInSeconds).toBe(3600);
    // 23:30 IST -> opens at 11:00 next day, 11.5h
    expect(computeStoreStatus(base, new Date("2026-10-14T18:00:00Z")).changesInSeconds).toBe(11.5 * 3600);
    expect(computeStoreStatus({ ...base, mode: "CLOSED" }).changesInSeconds).toBeNull();
  });
});

describe("Per-day schedule (Mon–Fri 3–10:30 PM, Sat–Sun 2–10:30 PM)", () => {
  const weekday = { open: true, openTime: "15:00", closeTime: "22:30" };
  const weekend = { open: true, openTime: "14:00", closeTime: "22:30" };
  // index 0 = Sunday
  const hours = { mode: "AUTO" as const, openTime: "15:00", closeTime: "22:30", closedMessage: "", days: [weekend, weekday, weekday, weekday, weekday, weekday, weekend] };
  // 2026-10-14 is a Wednesday, 17th Saturday, 18th Sunday. IST = UTC + 5:30.
  const at = (isoIst: string) => new Date(new Date(isoIst + "+05:30").toISOString());

  it("opens at 3 PM on weekdays and 2 PM on weekends", async () => {
    const { computeStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    const wedBefore = computeStoreStatus(hours, at("2026-10-14T14:30:00"));
    expect(wedBefore.isOpen).toBe(false);
    expect(wedBefore.changesInSeconds).toBe(1800);
    expect(wedBefore.message).toMatch(/3 PM/);
    expect(computeStoreStatus(hours, at("2026-10-14T15:00:00")).isOpen).toBe(true);
    expect(computeStoreStatus(hours, at("2026-10-14T22:29:00")).isOpen).toBe(true);
    expect(computeStoreStatus(hours, at("2026-10-14T22:30:00")).isOpen).toBe(false);
    // Saturday opens earlier
    expect(computeStoreStatus(hours, at("2026-10-17T14:30:00")).isOpen).toBe(true);
    expect(computeStoreStatus(hours, at("2026-10-17T13:59:00")).isOpen).toBe(false);
  });

  it("looks ahead across days for the next opening", async () => {
    const { computeStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    // Saturday night -> Sunday 2 PM
    const sat = computeStoreStatus(hours, at("2026-10-17T22:45:00"));
    expect(sat.isOpen).toBe(false);
    expect(sat.nextChangeTime).toBe("14:00");
    expect(sat.message).toMatch(/tomorrow at 2 PM/);
    // Sunday night -> Monday 3 PM
    const sun = computeStoreStatus(hours, at("2026-10-18T22:45:00"));
    expect(sun.nextChangeTime).toBe("15:00");
    expect(sun.message).toMatch(/tomorrow at 3 PM/);
  });

  it("summarises the week for the footer and supports closed days", async () => {
    const { computeStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    expect(computeStoreStatus(hours).weekSummary).toEqual([
      { label: "Mon–Fri", hours: "3 PM – 10:30 PM" },
      { label: "Sat–Sun", hours: "2 PM – 10:30 PM" },
    ]);
    const tuesdayOff = { ...hours, days: hours.days.map((d, i) => (i === 2 ? { ...d, open: false } : d)) };
    const s = computeStoreStatus(tuesdayOff, at("2026-10-13T16:00:00")); // Tuesday 4 PM
    expect(s.isOpen).toBe(false);
    expect(s.message).toMatch(/tomorrow at 3 PM/);
    expect(s.weekSummary.find((r) => r.label === "Tue")?.hours).toBe("Closed");
  });
});

describe("Status changes show up immediately", () => {
  it("a save is visible on the very next read despite the short cache", async () => {
    const { saveStoreHours, getStoreStatus } = await import("../src/modules/storeStatus/storeStatus.service");
    const base = { openTime: "00:00", closeTime: "00:00", closedMessage: "" };
    await saveStoreHours({ ...base, mode: "AUTO" }, "test-admin");
    expect((await getStoreStatus()).isOpen).toBe(true); // primes the cache
    await saveStoreHours({ ...base, mode: "CLOSED" }, "test-admin");
    expect((await getStoreStatus()).isOpen).toBe(false);
    await saveStoreHours({ ...base, mode: "AUTO" }, "test-admin");
    expect((await getStoreStatus()).isOpen).toBe(true);
  });
});
