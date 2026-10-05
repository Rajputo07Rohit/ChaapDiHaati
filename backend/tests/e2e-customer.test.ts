import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

// tests/setup.ts (vitest.config.ts setupFiles) already starts an in-memory
// Mongo replica set and connects mongoose before any test file runs, and
// sets JWT_SECRET/NODE_ENV=test. Deliberately NOT setting TWOFACTOR_API_KEY
// / RAZORPAY_* — customer tokens are minted directly here instead of going
// through the real 2Factor/Razorpay APIs, so this suite never makes an
// external network call or sends a real SMS / opens a real payment order.

describe("Customer self-order flow (e2e, in-memory DB)", () => {
  it("full flow", async () => {
    const { app } = await import("../src/app");
    const { MenuCategory, MenuItem } = await import("../src/db/models");
    // Mirrors the fix in connectMongo(): wait for background index builds
    // (notably the unique sparse index on clientIdempotencyKey) before
    // driving the idempotency-key race test below.
    await Promise.all(Object.values(mongoose.connection.models).map((m) => m.init()));
    const { setMenuPrice } = await import("../src/modules/menu/menu.service");
    const { issueCustomerToken, verifyCustomerToken } = await import(
      "../src/modules/customerAuth/customerAuth.service"
    );
    const { newId, nowIso } = await import("../src/utils/ids");
    const request = (await import("supertest")).default;

    // --- seed a menu item, like staff would set up in POS ---
    const catId = newId("cat");
    await MenuCategory.create({ _id: catId, name: "Mains", sortOrder: 0, active: true });
    const itemId = newId("menuitem");
    await MenuItem.create({
      _id: itemId,
      categoryId: catId,
      name: "Butter Chicken",
      hasHalf: false,
      hasFull: false,
      hasSingle: true,
      unitLabel: "plate",
      halfLabel: "Half",
      fullLabel: "Full",
      status: "ACTIVE",
      createdAt: nowIso(),
    });
    await setMenuPrice(itemId, "SINGLE", 25000, "test-admin"); // ₹250

    // Also seed a "Packaging" category — must be excluded from the public menu.
    const pkgCat = newId("cat");
    await MenuCategory.create({ _id: pkgCat, name: "Packaging", sortOrder: 1, active: true });

    // --- 1. Public menu browsing (no auth) ---
    const menuRes = await request(app).get("/api/public/menu");
    expect(menuRes.status).toBe(200);
    const categoryNames = menuRes.body.categories.map((c: any) => c.name);
    expect(categoryNames).toContain("Mains");
    expect(categoryNames).not.toContain("Packaging"); // internal category hidden
    const mains = menuRes.body.categories.find((c: any) => c.name === "Mains");
    expect(mains.items[0].name).toBe("Butter Chicken");
    console.log("[OK] Public menu lists items, hides internal 'Packaging' category");

    // --- 2. send-otp input validation (no real SMS sent: bad input rejected before reaching 2Factor) ---
    const badPhone = await request(app).post("/api/public/auth/send-otp").send({ phone: "12345" });
    expect(badPhone.status).toBe(400);
    console.log("[OK] send-otp rejects invalid phone format before calling 2Factor");

    // --- 3. mint a customer token directly (standing in for a real OTP round-trip) ---
    const phone = "+919876543210";
    const token = issueCustomerToken(phone);
    expect(verifyCustomerToken(token)).toBe(phone);
    console.log("[OK] issueCustomerToken/verifyCustomerToken round-trip");

    // --- 4. requireCustomerAuth blocks unauthenticated order creation ---
    const unauth = await request(app)
      .post("/api/public/orders")
      .send({ orderType: "DINE_IN", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] });
    expect(unauth.status).toBe(401);
    console.log("[OK] Order creation requires customer auth (401 without token)");

    // --- 5. DINE_IN order ---
    const dineIn = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "DINE_IN",
        tableLabel: "T4",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 2 }],
      });
    expect(dineIn.status).toBe(201);
    expect(dineIn.body.order.net_total_paise).toBe(50000); // 2 x 250
    expect(dineIn.body.order.delivery_fee_paise).toBe(0);
    // Response must NOT leak internal/staff-only fields.
    const leakedKeys = ["cogs_paise", "created_by", "discount_reason", "cancel_reason", "items", "payments"];
    for (const k of leakedKeys) expect(dineIn.body.order).not.toHaveProperty(k);
    expect(Object.keys(dineIn.body.order).sort()).toEqual(
      ["created_at", "delivery_fee_paise", "id", "net_total_paise", "notes", "order_number", "order_type", "payment_status", "status", "subtotal_paise"].sort()
    );
    console.log("[OK] DINE_IN order created, correct total, no internal fields leaked:", dineIn.body.order);

    // --- 6. TAKEAWAY order ---
    const takeaway = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderType: "TAKEAWAY", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] });
    expect(takeaway.status).toBe(201);
    expect(takeaway.body.order.net_total_paise).toBe(25000);
    console.log("[OK] TAKEAWAY order created");

    // --- 7. DELIVERY order — delivery fee tiers (server-computed) ---
    // subtotal ₹250 -> >= ₹200 tier -> free delivery
    const deliveryFree = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "DELIVERY",
        customerName: "Test Customer",
        deliveryAddress: "123 Test St",
        deliveryLatitude: 28.6,
        deliveryLongitude: 77.2,
        paymentProvider: "COD",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      });
    expect(deliveryFree.status).toBe(201);
    expect(deliveryFree.body.order.delivery_fee_paise).toBe(0);
    expect(deliveryFree.body.order.net_total_paise).toBe(25000);
    console.log("[OK] DELIVERY (subtotal >= 200) -> free delivery fee");

    // subtotal ₹250 x small qty to hit lower tiers: use quantity to control subtotal.
    // qty=1 => 250 (>=200 => free). Need smaller: there's only one item at 250,
    // so use a cheaper item for tier testing.
    const cheapItemId = newId("menuitem");
    await MenuItem.create({
      _id: cheapItemId,
      categoryId: catId,
      name: "Papad",
      hasHalf: false,
      hasFull: false,
      hasSingle: true,
      unitLabel: "plate",
      halfLabel: "Half",
      fullLabel: "Full",
      status: "ACTIVE",
      createdAt: nowIso(),
    });
    await setMenuPrice(cheapItemId, "SINGLE", 5000, "test-admin"); // ₹50

    // subtotal ₹50 -> < ₹100 tier -> ₹40 delivery fee
    const deliveryTier1 = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "DELIVERY",
        customerName: "Test Customer",
        deliveryAddress: "123 Test St",
        paymentProvider: "COD",
        items: [{ menuItemId: cheapItemId, priceType: "SINGLE", quantity: 1 }],
      });
    expect(deliveryTier1.status).toBe(201);
    expect(deliveryTier1.body.order.subtotal_paise).toBe(5000);
    expect(deliveryTier1.body.order.delivery_fee_paise).toBe(4000);
    expect(deliveryTier1.body.order.net_total_paise).toBe(9000);
    console.log("[OK] DELIVERY tier: subtotal <100 -> fee 40 Rs, net matches");

    // --- 8. DELIVERY requires name + address ---
    const deliveryMissingFields = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ orderType: "DELIVERY", paymentProvider: "COD", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] });
    expect(deliveryMissingFields.status).toBe(400);
    console.log("[OK] DELIVERY rejects missing name/address");

    // --- 9. MOCK payment refused outside dev/test? (NODE_ENV=test here, env.isProd=false, so MOCK allowed) ---
    const deliveryMock = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "DELIVERY",
        customerName: "Test",
        deliveryAddress: "addr",
        paymentProvider: "MOCK",
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      });
    expect(deliveryMock.status).toBe(201);
    expect(deliveryMock.body.order.payment_status).toBe("PAID");
    console.log("[OK] MOCK payment allowed in dev/test, marks order PAID");

    // --- 10. Idempotency key dedupe ---
    const idemKey = "test-idem-key-123";
    const first = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "TAKEAWAY",
        idempotencyKey: idemKey,
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post("/api/public/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({
        orderType: "TAKEAWAY",
        idempotencyKey: idemKey,
        items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }],
      });
    expect(second.status).toBe(201);
    expect(second.body.order.id).toBe(first.body.order.id); // same order returned, not a duplicate
    console.log("[OK] Idempotency key dedupes a retried submit -> same order id returned");

    // --- 11. Concurrent double-tap with same idempotency key -> still exactly one order ---
    const raceKey = "race-key-456";
    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/public/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ orderType: "TAKEAWAY", idempotencyKey: raceKey, items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] }),
      request(app)
        .post("/api/public/orders")
        .set("Authorization", `Bearer ${token}`)
        .send({ orderType: "TAKEAWAY", idempotencyKey: raceKey, items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.order.id).toBe(r2.body.order.id);
    console.log("[OK] Concurrent double-tap with same key still resolves to exactly one order");

    // --- 12. Full staff-facing order detail has delivery_latitude/longitude populated for rider nav ---
    const { getOrderOrThrow } = await import("../src/modules/orders/orders.service");
    const full = await getOrderOrThrow(deliveryFree.body.order.id);
    expect(full.delivery_latitude).toBe(28.6);
    expect(full.delivery_longitude).toBe(77.2);
    console.log("[OK] Staff-facing order detail retains GPS coords for RiderDashboard navigation link");

    // --- 13. Expired/garbage token rejected ---
    const badToken = await request(app)
      .post("/api/public/orders")
      .set("Authorization", "Bearer not-a-real-token")
      .send({ orderType: "TAKEAWAY", items: [{ menuItemId: itemId, priceType: "SINGLE", quantity: 1 }] });
    expect(badToken.status).toBe(401);
    console.log("[OK] Garbage bearer token rejected with 401");
  }, 30_000);
});
