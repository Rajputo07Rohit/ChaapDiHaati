import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middleware/errorHandler";

export const app = express();

// Render (and Netlify's API proxy in front of it) terminates TLS and
// forwards requests through a proxy layer — without this, req.ip is the
// proxy's own address for every request, which silently broke IP-based
// rate limiting (everyone shared one bucket) and would make a login's
// recorded IP useless.
app.set("trust proxy", 1);

app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please try again later.", code: "RATE_LIMITED" } },
});
app.use("/api/auth/login", authLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api", apiRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { message: "Not found.", code: "NOT_FOUND" } });
});

app.use(errorHandler);
