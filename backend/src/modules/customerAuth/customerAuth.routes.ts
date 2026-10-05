import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidationError } from "../../utils/errors";
import * as customerAuthService from "./customerAuth.service";

export const customerAuthRouter = Router();

/** Accepts a plain 10-digit Indian mobile number or one already in +91 E.164 form. */
function toE164(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  if (trimmed.startsWith("+91")) return /^\+91[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
  return /^[6-9]\d{9}$/.test(trimmed) ? `+91${trimmed}` : null;
}

const sendOtpSchema = z.object({ phone: z.string() });

customerAuthRouter.post(
  "/send-otp",
  asyncHandler(async (req, res) => {
    const { phone } = sendOtpSchema.parse(req.body);
    const e164 = toE164(phone);
    if (!e164) throw new ValidationError("Please enter a valid 10-digit Indian mobile number.");

    const sessionId = await customerAuthService.sendOtp(e164);
    res.json({ sessionId });
  })
);

const verifyOtpSchema = z.object({
  sessionId: z.string().min(1),
  otp: z.string().min(1),
  phone: z.string(),
});

customerAuthRouter.post(
  "/verify-otp",
  asyncHandler(async (req, res) => {
    const { sessionId, otp, phone } = verifyOtpSchema.parse(req.body);
    const e164 = toE164(phone);
    if (!e164) throw new ValidationError("Please enter a valid 10-digit Indian mobile number.");

    await customerAuthService.verifyOtp(sessionId, otp);
    const token = customerAuthService.issueCustomerToken(e164);
    res.json({ token, phone: e164 });
  })
);
