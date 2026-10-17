import dotenv from "dotenv";

dotenv.config();

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

const DEV_JWT_SECRET = "dev-only-insecure-secret-change-me";
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
  throw new Error("JWT_SECRET must be set to a random string of at least 32 characters in production.");
}

export const env = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  mongodbUri: required("MONGODB_URI", "mongodb://127.0.0.1:27017/chaapdihaati"),
  jwtSecret: required("JWT_SECRET", DEV_JWT_SECRET),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "12h",
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",
  bcryptSaltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || "10", 10),
  isProd: process.env.NODE_ENV === "production",
  // Optional: customer-facing phone OTP via 2Factor.in. Left unset until
  // that's configured — requireCustomerAuth/sendOtp report a clear config
  // error rather than the app failing to boot.
  twoFactorApiKey: process.env.TWOFACTOR_API_KEY,
  // Cashfree Payments (UPI / cards / netbanking / wallets). "sandbox" uses
  // Cashfree's test environment — no real money moves. Set CASHFREE_ENV=production
  // together with live keys only when going live.
  cashfreeAppId: process.env.CASHFREE_APP_ID,
  cashfreeSecretKey: process.env.CASHFREE_SECRET_KEY,
  cashfreeEnv: (process.env.CASHFREE_ENV === "production" ? "production" : "sandbox") as "sandbox" | "production",
  // Optional: browser push notifications to customers (order accepted, on the
  // way, cancelled + refund…). Generate a pair with `npx web-push generate-vapid-keys`.
  // Push is simply skipped while unset.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || "mailto:owner@chaapdihaati.in",
  // Optional: WhatsApp order updates via the WhatsApp Business Cloud API (Meta).
  // Skipped while unset. The template must be approved in WhatsApp Manager first.
  whatsappToken: process.env.WHATSAPP_TOKEN,
  whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappTemplateName: process.env.WHATSAPP_TEMPLATE_NAME || "order_update",
  whatsappTemplateLang: process.env.WHATSAPP_TEMPLATE_LANG || "en",
  // Optional: error reporting to Sentry. Skipped while unset.
  sentryDsn: process.env.SENTRY_DSN,
  // Public URL of the customer app — used for links inside notifications.
  customerAppUrl: (process.env.CUSTOMER_APP_URL || "").replace(/\/$/, ""),
};
