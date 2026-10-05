import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { AppError, UnauthorizedError, ValidationError } from "../../utils/errors";

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
const OTP_TEMPLATE_NAME = "CDHOtp";

/** Sends an OTP via 2Factor.in and returns the session id needed to verify it. */
export async function sendOtp(phone: string): Promise<string> {
  const apiKey = requireApiKey();
  const res = await fetch(`https://2factor.in/API/V1/${apiKey}/SMS/${phone}/AUTOGEN/${OTP_TEMPLATE_NAME}`);
  const body = (await res.json().catch(() => null)) as { Status?: string; Details?: string } | null;

  if (!res.ok || body?.Status !== "Success" || !body.Details) {
    throw new ValidationError("Could not send the verification code. Please check the number and try again.");
  }
  return body.Details;
}

/** Verifies the OTP against 2Factor.in; throws if it doesn't match. */
export async function verifyOtp(sessionId: string, otp: string): Promise<void> {
  const apiKey = requireApiKey();
  const res = await fetch(`https://2factor.in/API/V1/${apiKey}/SMS/VERIFY/${sessionId}/${otp}`);
  const body = (await res.json().catch(() => null)) as { Status?: string } | null;

  if (!res.ok || body?.Status !== "Success") {
    throw new UnauthorizedError("That code doesn't match. Please check and try again.");
  }
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
