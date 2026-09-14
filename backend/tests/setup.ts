import path from "path";
import fs from "fs";

const testDbPath = path.join(__dirname, ".test.db");
for (const suffix of ["", "-wal", "-shm"]) {
  const p = testDbPath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

process.env.DATABASE_PATH = testDbPath;
process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";

// Dynamic import (not a static `import`) so process.env is set BEFORE the
// migration/connection modules — and every service module that does
// db.prepare(...) at top-level — are ever loaded.
const { runMigrations } = await import("../src/db/migrate");
runMigrations();
