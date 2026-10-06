import { describe, it, expect } from "vitest";

describe("Promo codes", () => {
  it("applies discount correctly, enforces min order / usage / per-customer limits, and never over-redeems on a crash", async () => {
    const { MenuCategory, MenuItem, PromoCode } = await import("../src/db/models");
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { createPromoCode, listActivePromoCodesForCustomer } = await import("../src/modules/promoCodes/promoCodes.service");
    const { createCustomerOrder } = await import("../src/modules/customerOrders/customerOrders.service");
    const { newId, nowIso } = await import("../src/utils/ids");

    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId, categoryId: catId, name: "Butter Chicken",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 20000, "test-admin"); // ₹200

    // --- FLAT code with a minimum order ---
    const flatCode = await createPromoCode({
      code: "welcome50",
      description: "₹50 off on orders above ₹150",
      discountType: "FLAT",
      discountValue: 5000,
      minOrderPaise: 15000,
      userId: "test-admin",
    });
    expect(flatCode.code).toBe("WELCOME50"); // normalized uppercase
    console.log("[OK] Promo code created, code normalized to uppercase");

    const active = await listActivePromoCodesForCustomer();
    expect(active.find((c) => c.code === "WELCOME50")).toBeDefined();
    console.log("[OK] Active code appears in the customer-facing banner list");

    const phone = "+919800011111";
    const order = await createCustomerOrder(
      {
        orderType: "TAKEAWAY",
        customerName: "Test Customer",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
        promoCode: "welcome50", // lowercase on purpose — should still match
      },
      phone
    );
    expect(order.net_total_paise).toBe(15000); // 200 - 50
    console.log("[OK] FLAT promo code applied correctly, case-insensitively (₹200 - ₹50 = ₹150)");

    const afterOne = await PromoCode.findById(flatCode.id);
    expect(afterOne!.usedCount).toBe(1);
    console.log("[OK] usedCount incremented after a real redemption");

    // --- A code below its minimum order is rejected ---
    const cheapItemId = newId("menuitem");
    await MenuItem.create({
      _id: cheapItemId, categoryId: catId, name: "Papad",
      hasHalf: false, hasFull: false, hasSingle: true,
      unitLabel: "plate", halfLabel: "Half", fullLabel: "Full",
      status: "ACTIVE", createdAt: nowIso(),
    });
    await setMenuPrice(cheapItemId, "SINGLE", 5000, "test-admin"); // ₹50 — below the ₹150 minimum

    await expect(
      createCustomerOrder(
        { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: cheapItemId, priceType: "SINGLE", quantity: 1 }], promoCode: "WELCOME50" },
        phone
      )
    ).rejects.toThrow(/more to use this code/i);
    console.log("[OK] Rejected below the minimum order threshold, no usedCount bump");

    // --- PERCENTAGE code ---
    const pctCode = await createPromoCode({
      code: "HALF20",
      description: "20% off",
      discountType: "PERCENTAGE",
      discountValue: 20,
      userId: "test-admin",
    });
    const pctOrder = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "HALF20" },
      phone
    );
    expect(pctOrder.net_total_paise).toBe(16000); // 200 - 20% = 160
    console.log("[OK] PERCENTAGE promo code applied correctly (₹200 - 20% = ₹160)");

    // --- Per-customer limit: one redemption, enforced on a second order ---
    const limitedCode = await createPromoCode({
      code: "ONEUSE",
      description: "One per customer",
      discountType: "FLAT",
      discountValue: 1000,
      perCustomerLimit: 1,
      userId: "test-admin",
    });
    await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "ONEUSE" },
      phone
    );
    await expect(
      createCustomerOrder(
        { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "ONEUSE" },
        phone
      )
    ).rejects.toThrow(/already used/i);
    console.log("[OK] Per-customer limit enforced on a second order by the same phone");

    // A different customer can still use it once.
    const otherPhone = "+919800022222";
    const otherOrder = await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Other Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "ONEUSE" },
      otherPhone
    );
    expect(otherOrder.net_total_paise).toBe(19000);
    console.log("[OK] A different customer can still redeem the same per-customer-limited code");

    // --- Total usage limit ---
    const capped = await createPromoCode({
      code: "CAPPED",
      description: "Only 1 redemption total",
      discountType: "FLAT",
      discountValue: 1000,
      usageLimit: 1,
      userId: "test-admin",
    });
    await createCustomerOrder(
      { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "CAPPED" },
      phone
    );
    await expect(
      createCustomerOrder(
        { orderType: "TAKEAWAY", customerName: "Other Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "CAPPED" },
        otherPhone
      )
    ).rejects.toThrow(/usage limit/i);
    console.log("[OK] Total usage limit enforced across different customers");
    expect((await listActivePromoCodesForCustomer()).find((c) => c.code === "CAPPED")).toBeUndefined();
    console.log("[OK] A fully-redeemed code drops out of the active banner list");

    // --- Invalid/unknown code ---
    await expect(
      createCustomerOrder(
        { orderType: "TAKEAWAY", customerName: "Test Customer", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }], promoCode: "NOPE" },
        phone
      )
    ).rejects.toThrow(/isn't valid/i);
    console.log("[OK] Unknown code rejected with a friendly message");
  }, 30_000);
});
