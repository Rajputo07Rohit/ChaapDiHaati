import { runMigrations } from "./db/migrate";

// Migrations must run before any other module is loaded — several service
// modules call db.prepare(...) at module top-level, and under tsx/esbuild
// `import` statements are hoisted above this call, so require() (a real
// runtime call) is used instead to guarantee ordering on a fresh database.
runMigrations();

/* eslint-disable @typescript-eslint/no-var-requires */
const { app } = require("./app") as typeof import("./app");
const { env } = require("./config/env") as typeof import("./config/env");
/* eslint-enable @typescript-eslint/no-var-requires */

app.listen(env.port, () => {
  console.log(`Chaap Di Haati RMS backend listening on port ${env.port} (${env.nodeEnv})`);
});
