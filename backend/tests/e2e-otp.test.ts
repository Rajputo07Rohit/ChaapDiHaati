import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => vi.unstubAllGlobals());

describe("Customer OTP sign-in", () => {
  it("a code sent to one number can never sign in as another, and guessing is capped", async () => {
    const { env } = await import("../src/config/env");
    env.twoFactorApiKey = "test-key";
    const { app } = await import("../src/app");
    const request = (await import("supertest")).default;
    const { verifyCustomerToken } = await import("../src/modules/customerAuth/customerAuth.service");

    // Fake 2Factor: one session per send, the code is always 123456.
    let n = 0;
    const sent: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const json = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
      const verify = url.match(/\/(SMS|VOICE)\/VERIFY\/([^/]+)\/([^/]+)$/);
      if (verify) return json({ Status: verify[3] === "123456" ? "Success" : "Error", Details: "" });
      sent.push(url);
      return json({ Status: "Success", Details: `sess-${++n}` });
    });

    const attacker = "9800000001";
    const victim = "9800000002";
    const send = (phone: string, channel?: string) => request(app).post("/api/public/auth/send-otp").send({ phone, channel });
    const verify = (sessionId: string, otp: string, phone: string) =>
      request(app).post("/api/public/auth/verify-otp").send({ sessionId, otp, phone });

    // The attack: get a real code on your own phone, then claim to be someone else.
    const { sessionId } = (await send(attacker)).body;
    const hijack = await verify(sessionId, "123456", victim);
    expect(hijack.status).toBe(401);
    expect(hijack.body.token).toBeUndefined();

    // The rightful owner of the code signs in as themselves only.
    const ok = await verify(sessionId, "123456", attacker);
    expect(ok.status).toBe(200);
    expect(ok.body.phone).toBe(`+91${attacker}`);
    expect(verifyCustomerToken(ok.body.token)).toBe(`+91${attacker}`);

    // A code works once.
    expect((await verify(sessionId, "123456", attacker)).status).toBe(401);

    // Voice fallback goes to the VOICE endpoint and verifies the same way.
    const voice = (await send(victim, "VOICE")).body.sessionId;
    expect(sent.at(-1)).toMatch(/\/VOICE\/\+919800000002\/AUTOGEN$/);
    expect((await verify(voice, "123456", victim)).body.phone).toBe(`+91${victim}`);

    // Guessing: after 5 wrong codes the session is dead, even with the right one.
    // (Checked at the service level — the per-IP limiter would stop an HTTP attacker even sooner.)
    const { sendOtp, verifyOtp } = await import("../src/modules/customerAuth/customerAuth.service");
    const s2 = await sendOtp(`+91${victim}`);
    for (let i = 0; i < 5; i++) await expect(verifyOtp(s2, "000000", `+91${victim}`)).rejects.toThrow(/doesn't match/);
    await expect(verifyOtp(s2, "123456", `+91${victim}`)).rejects.toThrow(/Too many wrong tries/);

    // A made-up session id gets nothing.
    await expect(verifyOtp("sess-unknown", "123456", `+91${victim}`)).rejects.toThrow(/expired/);
  });
});
