import fs from "fs";
import { env } from "../config/env";

for (const suffix of ["", "-wal", "-shm"]) {
  const p = env.databasePath + suffix;
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
console.log("Database file removed. Run `npm run migrate` then `npm run seed` to rebuild.");
