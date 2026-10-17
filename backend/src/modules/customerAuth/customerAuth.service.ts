import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError, UnauthorizedError, ValidationError } from "../../utils/errors";
import { OtpSession } from "../../db/models";

const OTP_VALID_MINUTES = 15;
/** Wrong guesses allowed per code before a new one must be requested. */
const MAX_OTP_ATTEMPTS = 5;

interface CustomerJwtPayload {
  phone: string;
  typ: "customer";
}

function requireApiKey(): string {
  if (!env.twoFactorApiKey) {
    throw new AppError(
      500,
      "Phone verification isn't configured yet. Please try again later.",
      "OTP_NOT_CONFIGURED",
      "Missing TWOFACTOR_API_KEY env var."
    );
  }
  return env.twoFactorApiKey;
}

// The approved DLT template registered in the 2Factor dashboard
// (SMS OTP > OTP Templates) — without naming it, 2Factor has no approved
// SMS template to send and silently falls back to a voice call instead.
const OTP_TEMPLATE_NAME = "OTP1";

export type OtpChannel = "SMS" | "VOICE";

/**
 * Sends an OTP via 2Factor.in and returns the session id needed to verify it.
 * VOICE is the fallback when an SMS is delayed or blocked: 2Factor phones the
 * number and reads the code out.
 */
export async function sendOtp(phone: string, channel: OtpChannel = "SMS"): Promise<string> {
  const apiKey = requireApiKey();
  const url =
    channel === "VOICE"
      ? `https://2factor.in/API/V1/${apiKey}/VOICE/${phone}/AUTOGEN`
      : `https://2factor.in/API/V1/${apiKey}/SMS/${phone}/AUTOGEN/${OTP_TEMPLATE_NAME}`;
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as { Status?: string; Details?: string } | null;

  if (!res.ok || body?.Status !== "Success" || !body.Details) {
    throw new ValidationError("Could not send the verification code. Please check the number and try again.");
  }
  await OtpSession.create({ _id: body.Details, phone, channel, attempts: 0, expiresAt: new Date(Date.now() + OTP_VALID_MINUTES * 60_000) });
  return body.Details;
}

/** Verifies the OTP against 2Factor.in; throws if it doesn't match. */
/**
 * Verifies the OTP against 2Factor.in and returns the phone it was SENT to —
 * the only phone the caller may sign in as. Throws if it doesn't match.
 */
export async function verifyOtp(sessionId: string, otp: string, phone: string): Promise<string> {
  const apiKey = requireApiKey();
  const session = await OtpSession.findById(sessionId);
  if (!session || session.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError("This code has expired. Please request a new one.");
  }
  if (session.phone !== phone) {
    throw new UnauthorizedError("That code doesn't match. Please check and try again.");
  }
  if (session.attempts >= MAX_OTP_ATTEMPTS) {
    await OtpSession.deleteOne({ _id: sessionId });
    throw new UnauthorizedError("Too many wrong tries. Please request a new code.");
  }
  session.attempts += 1;
  await session.save();
  const channel = session.channel;
  const res = await fetch(
    `https://2factor.in/API/V1/${apiKey}/${channel}/VERIFY/${encodeURIComponent(sessionId)}/${encodeURIComponent(otp)}`
  );
  const body = (await res.json().catch(() => null)) as { Status?: string } | null;

  if (!res.ok || body?.Status !== "Success") {
    throw new UnauthorizedError("That code doesn't match. Please check and try again.");
  }
  // One code, one sign-in.
  await OtpSession.deleteOne({ _id: sessionId });
  return session.phone;
}

/** Long-lived on purpose — a returning customer shouldn't have to re-verify every visit. */
export function issueCustomerToken(phone: string): string {
  return jwt.sign({ phone, typ: "customer" } as CustomerJwtPayload, env.jwtSecret, { expiresIn: "30d" });
}

export function verifyCustomerToken(token: string): string {
  const payload = jwt.verify(token, env.jwtSecret) as CustomerJwtPayload;
  if (payload.typ !== "customer" || !payload.phone) throw new Error("Not a customer token");
  return payload.phone;
}
