import { describe, it, expect } from "vitest";
import path from "path";
import fs from "fs";

describe("Banner carousel", () => {
  it("admin uploads an image, it's servable as a static file, and shows up in the public active list", async () => {
    const { app } = await import("../src/app");
    const { User } = await import("../src/db/models");
    const { newId, nowIso } = await import("../src/utils/ids");
    const bcrypt = (await import("bcryptjs")).default;
    const jwt = (await import("jsonwebtoken")).default;
    const request = (await import("supertest")).default;

    const adminId = newId("user");
    await User.create({
      _id: adminId, username: "banneradmin", passwordHash: bcrypt.hashSync("x", 4),
      fullName: "Banner Admin", role: "ADMIN", active: true, createdAt: nowIso(), updatedAt: nowIso(),
    });
    const token = jwt.sign({ sub: adminId }, process.env.JWT_SECRET!);

    // A minimal valid 1x1 PNG, written to a temp file to upload.
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    const tmpFile = path.join(process.cwd(), "tests", "tmp-test-banner.png");
    fs.writeFileSync(tmpFile, pngBytes);

    try {
      const createRes = await request(app)
        .post("/api/banners")
        .set("Authorization", `Bearer ${token}`)
        .field("title", "Diwali Special")
        .attach("image", tmpFile);
      expect(createRes.status).toBe(201);
      expect(createRes.body.banner.image_url).toMatch(/^\/uploads\/banners\/.+\.png$/);
      expect(createRes.body.banner.title).toBe("Diwali Special");
      expect(createRes.body.banner.active).toBe(true);
      console.log("[OK] Banner uploaded, image_url points at /uploads/banners/*.png");

      // The uploaded file is actually servable as a static asset.
      const imageRes = await request(app).get(createRes.body.banner.image_url);
      expect(imageRes.status).toBe(200);
      expect(imageRes.headers["content-type"]).toMatch(/^image\//);
      console.log("[OK] Uploaded image is servable as a static file");

      // Shows up in the customer-facing active list.
      const activeRes = await request(app).get("/api/public/banners/active");
      expect(activeRes.status).toBe(200);
      expect(activeRes.body.banners.find((b: any) => b.id === createRes.body.banner.id)).toBeDefined();
      console.log("[OK] Uploaded banner appears in the public active list");

      // Deactivating removes it from the public list.
      await request(app).patch(`/api/banners/${createRes.body.banner.id}`).set("Authorization", `Bearer ${token}`).send({ active: false });
      const activeAfter = await request(app).get("/api/public/banners/active");
      expect(activeAfter.body.banners.find((b: any) => b.id === createRes.body.banner.id)).toBeUndefined();
      console.log("[OK] Deactivated banner drops out of the public active list");

      // Non-image uploads are rejected.
      const txtFile = path.join(process.cwd(), "tests", "tmp-test-banner.txt");
      fs.writeFileSync(txtFile, "not an image");
      try {
        const badRes = await request(app).post("/api/banners").set("Authorization", `Bearer ${token}`).attach("image", txtFile);
        expect(badRes.status).toBe(400);
        console.log("[OK] Non-image file upload rejected with 400");
      } finally {
        fs.unlinkSync(txtFile);
      }

      // Non-admin (no auth) can't upload.
      const noAuth = await request(app).post("/api/banners").attach("image", tmpFile);
      expect(noAuth.status).toBe(401);
      console.log("[OK] Upload requires admin auth (401 without a token)");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  }, 30_000);
});
