import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  mongodbUri: required("MONGODB_URI", "mongodb://127.0.0.1:27017/chaapdihaati"),
  jwtSecret: required("JWT_SECRET", "dev-only-insecure-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10),
  isProd: process.env.NODE_ENV === "production",
  // Optional: customer-facing phone OTP via 2Factor.in. Left unset until
  // that's configured — requireCustomerAuth/sendOtp report a clear config
  // error rather than the app failing to boot.
  twoFactorApiKey: process.env.TWOFACTOR_API_KEY,
  // Optional: Razorpay test-mode checkout for customer self-orders. Left
  // unset until configured — createRazorpayOrder reports a clear config
  // error rather than the app failing to boot.
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
};
