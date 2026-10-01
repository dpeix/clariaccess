import { createDb } from "../src/client.js";
import { runMigrations, seedRules } from "../src/migrate.js";

const url = process.env["DATABASE_URL"];
if (url === undefined) {
  throw new Error("DATABASE_URL is not set (see .env.example)");
}

const db = createDb(url);
try {
  await runMigrations(db);
  await seedRules(db);
  console.log("Migrations applied and rules seeded.");
} finally {
  await db.$client.end();
}
