import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler";
import { ValidationError } from "../../utils/errors";
import { otpSendLimiter, otpVerifyLimiter } from "../../middleware/security";
import * as customerAuthService from "./customerAuth.service";

export const customerAuthRouter = Router();

/** Accepts a plain 10-digit Indian mobile number or one already in +91 E.164 form. */
function toE164(rawPhone: string): string | null {
  const trimmed = rawPhone.trim();
  if (trimmed.startsWith("+91")) return /^\+91[6-9]\d{9}$/.test(trimmed) ? trimmed : null;
  return /^[6-9]\d{9}$/.test(trimmed) ? `+91${trimmed}` : null;
}

const channelSchema = z.enum(["SMS", "VOICE"]).optional();
const sendOtpSchema = z.object({ phone: z.string(), channel: channelSchema });

customerAuthRouter.post(
  "/send-otp",
  otpSendLimiter,
  asyncHandler(async (req, res) => {
    const { phone, channel } = sendOtpSchema.parse(req.body);
    const e164 = toE164(phone);
    if (!e164) throw new ValidationError("Please enter a valid 10-digit Indian mobile number.");

    const sessionId = await customerAuthService.sendOtp(e164, channel);
    res.json({ sessionId });
  })
);

const verifyOtpSchema = z.object({
  sessionId: z.string().min(1),
  otp: z.string().regex(/^\d{4,8}$/, "Enter the code you received."),
  phone: z.string(),
  channel: channelSchema,
});

customerAuthRouter.post(
  "/verify-otp",
  otpVerifyLimiter,
  asyncHandler(async (req, res) => {
    const { sessionId, otp, phone } = verifyOtpSchema.parse(req.body);
    const e164 = toE164(phone);
    if (!e164) throw new ValidationError("Please enter a valid 10-digit Indian mobile number.");

    // The token is for the phone the code was sent to, never just the one named in this request.
    const verifiedPhone = await customerAuthService.verifyOtp(sessionId, otp, e164);
    const token = customerAuthService.issueCustomerToken(verifiedPhone);
    res.json({ token, phone: verifiedPhone });
  })
);
