import { createDb } from "@accessibility/db";
import { setOrganizationPlan } from "./set-plan.js";

// Administration only: `pnpm --filter @accessibility/api set-plan <orgId> <plan>`.
// Until a payment integration exists this is the way an organization changes plan.
const [orgId, plan] = process.argv.slice(2);
if (orgId === undefined || plan === undefined) {
  console.error("usage: set-plan <organization-id> <plan>");
  process.exit(2);
}
const url = process.env["DATABASE_URL"];
if (url === undefined) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

const db = createDb(url);
try {
  const result = await setOrganizationPlan(db, orgId, plan);
  console.log(`organization ${orgId}: ${result.previous} -> ${result.plan}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$client.end();
}
