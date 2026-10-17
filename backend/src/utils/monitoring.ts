import * as Sentry from "@sentry/node";
import { env } from "../config/env";

/**
 * Error reporting to Sentry, so a crash on the live site reaches the owner's
 * inbox instead of only the server log. Does nothing while SENTRY_DSN is unset.
 */
let enabled = false;
if (env.sentryDsn) {
  try {
    Sentry.init({ dsn: env.sentryDsn, environment: env.nodeEnv, tracesSampleRate: 0 });
    enabled = true;
  } catch (err) {
    console.error("Sentry init failed:", err);
  }
}

export function reportError(err: unknown, context: Record<string, unknown> = {}): void {
  if (!enabled) return;
  Sentry.captureException(err, { extra: context });
}
