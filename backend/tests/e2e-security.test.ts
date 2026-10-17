import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

/**
 * Abuse checks for everything a customer (or a curious stranger) can reach:
 * nobody should be able to change the store, plant misleading links, upload
 * script disguised as an image, or break the shop by flooding it.
 */
async function setup() {
  const { app } = await import("../src/app");
  const { User } = await import("../src/db/models");
  const { newId, nowIso } = await import("../src/utils/ids");
  const { issueCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");
  const bcrypt = (await import("bcryptjs")).default;
  const jwt = (await import("jsonwebtoken")).default;
  const request = (await import("supertest")).default;

  const mkUser = async (role: "ADMIN" | "STAFF") => {
    const id = newId("user");
    await User.create({
      _id: id, username: `${role.toLowerCase()}_${id.slice(-6)}`, passwordHash: bcrypt.hashSync("x", 4),
      fullName: role, role, active: true, createdAt: nowIso(), updatedAt: nowIso(),
    });
    return jwt.sign({ sub: id }, process.env.JWT_SECRET!);
  };
  return { app, request, admin: await mkUser("ADMIN"), staff: await mkUser("STAFF"), customer: issueCustomerToken("+919811122233") };
}

describe("Security / abuse protections", () => {
  it("customers and strangers can't touch staff controls; staff can only pause/resume", async () => {
    const { app, request, admin, staff, customer } = await setup();
    const hours = { mode: "AUTO", openTime: "00:00", closeTime: "00:00", closedMessage: "" };

    expect((await request(app).put("/api/store-hours/mode").send({ mode: "CLOSED" })).status).toBe(401);
    expect((await request(app).put("/api/store-hours/mode").set("Authorization", `Bearer ${customer}`).send({ mode: "CLOSED" })).status).toBe(401);
    expect((await request(app).put("/api/store-hours").set("Authorization", `Bearer ${customer}`).send(hours)).status).toBe(401);
    expect((await request(app).put("/api/settings/business-profile").set("Authorization", `Bearer ${customer}`).send({ businessName: "Hacked" })).status).toBe(401);
    expect((await request(app).post("/api/banners").set("Authorization", `Bearer ${customer}`)).status).toBe(401);
    expect((await request(app).get("/api/orders").set("Authorization", `Bearer ${customer}`)).status).toBe(401);

    // staff: pause/resume yes, rewrite the schedule or business details no
    expect((await request(app).put("/api/store-hours").set("Authorization", `Bearer ${staff}`).send(hours)).status).toBe(403);
    expect((await request(app).put("/api/settings/business-profile").set("Authorization", `Bearer ${staff}`).send({ businessName: "X" })).status).toBe(403);
    expect((await request(app).put("/api/store-hours/mode").set("Authorization", `Bearer ${staff}`).send({ mode: "CLOSED" })).status).toBe(200);
    expect((await request(app).get("/api/public/store-status")).body.isOpen).toBe(false);
    expect((await request(app).put("/api/store-hours/mode").set("Authorization", `Bearer ${admin}`).send({ mode: "AUTO" })).status).toBe(200);
    expect((await request(app).get("/api/public/store-status")).body.isOpen).toBe(true);
  }, 30_000);

  it("business links shown to customers must be real https links (no javascript:, no fake Instagram)", async () => {
    const { app, request, admin } = await setup();
    const put = (body: object) =>
      request(app).put("/api/settings/business-profile").set("Authorization", `Bearer ${admin}`).send({ businessName: "Chaap Di Haati", ...body });

    expect((await put({ mapsUrl: "javascript:alert(document.cookie)" })).status).toBe(400);
    expect((await put({ reviewUrl: "http://evil.example/phish" })).status).toBe(400);
    expect((await put({ reviewUrl: 'https://ok.example/" onclick="x' })).status).toBe(400);
    expect((await put({ instagram: "Desi Chaap Di Haati || BIT" })).status).toBe(400);
    expect((await put({ instagram: "https://evil.example/desi" })).status).toBe(400);

    const ok = await put({
      mapsUrl: "https://maps.app.goo.gl/VUCj22HZXYZkSA1K6",
      reviewUrl: "https://maps.app.goo.gl/rTocnqdde3bYs54b9",
      instagram: "desi_chaap_di_hatti_bit",
    });
    expect(ok.status).toBe(200);
    const info = (await request(app).get("/api/public/business-info")).body;
    expect(info.instagram).toBe("desi_chaap_di_hatti_bit");
    expect(info.mapsUrl).toBe("https://maps.app.goo.gl/VUCj22HZXYZkSA1K6");
    // nothing secret leaks through the public endpoint
    expect(Object.keys(info).sort()).toEqual(["address", "businessName", "instagram", "mapsUrl", "phone", "pureVeg", "reviewUrl", "supportWhatsapp", "tagline"]);
    // the support WhatsApp number is a phone number, nothing else
    expect((await put({ supportWhatsapp: "https://wa.me/evil" })).status).toBe(400);
    expect((await put({ supportWhatsapp: "+91 98765 43210", pureVeg: true })).status).toBe(200);
    const info2 = (await request(app).get("/api/public/business-info")).body;
    expect(info2.supportWhatsapp).toBe("+91 98765 43210");
    expect(info2.pureVeg).toBe(true);
  }, 30_000);

  it("banner uploads accept real images only, and served images can't run script", async () => {
    const { app, request, admin } = await setup();
    const dir = path.join(process.cwd(), "tests");
    const svg = path.join(dir, "tmp-evil.svg");
    const png = path.join(dir, "tmp-ok.png");
    fs.writeFileSync(svg, '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
    fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));
    try {
      const bad = await request(app).post("/api/banners").set("Authorization", `Bearer ${admin}`).attach("image", svg);
      expect(bad.status).toBe(400);

      const good = await request(app).post("/api/banners").set("Authorization", `Bearer ${admin}`).attach("image", png);
      expect(good.status).toBe(201);
      const img = await request(app).get(good.body.banner.image_url);
      expect(img.status).toBe(200);
      expect(img.headers["content-type"]).toBe("image/png");
      expect(img.headers["x-content-type-options"]).toBe("nosniff");
      expect(img.headers["content-security-policy"]).toContain("sandbox");
    } finally {
      fs.unlinkSync(svg);
      fs.unlinkSync(png);
    }
  }, 30_000);

  it("a corrupted store-hours setting can't take the shop's status page down", async () => {
    const { app, request } = await setup();
    const { setSetting } = await import("../src/modules/settings/settings.service");
    await setSetting("store_hours", { mode: "WEIRD", openTime: "nope", days: [1, 2, 3] }, "test");
    await new Promise((r) => setTimeout(r, 3100)); // let the 3s status cache lapse
    const res = await request(app).get("/api/public/store-status");
    expect(res.status).toBe(200);
    expect(typeof res.body.isOpen).toBe("boolean");
    await setSetting("store_hours", { mode: "AUTO", openTime: "00:00", closeTime: "00:00", closedMessage: "" }, "test");
  }, 30_000);

  it("polling reads are never rate-limited at normal use, but order/OTP spam is", async () => {
    const { app, request } = await setup();
    // ~a few customers on one Wi-Fi polling the store status for a while
    for (let i = 0; i < 60; i++) {
      expect((await request(app).get("/api/public/store-status")).status).toBe(200);
    }
    // order spam from one IP is cut off
    const codes: number[] = [];
    for (let i = 0; i < 35; i++) codes.push((await request(app).post("/api/public/orders").send({})).status);
    expect(codes.slice(0, 30).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(30).every((c) => c === 429)).toBe(true);
  }, 60_000);
});
