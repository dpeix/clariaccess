import { existsSync } from "node:fs";
import { chromium } from "playwright";

// WORKER_INTEGRATION=1 (set by the dedicated CI job) turns a missing database
// or browser into a failure. Without it, tests that need them skip, so a plain
// `pnpm test` works on a machine that has neither.
const strict = process.env["WORKER_INTEGRATION"] === "1";

export function adminDatabaseUrl(): string | undefined {
  const url = process.env["DATABASE_URL"];
  if (url === undefined && strict) {
    throw new Error("DATABASE_URL is required when WORKER_INTEGRATION=1");
  }
  return url;
}

export function chromiumAvailable(): boolean {
  const installed = existsSync(chromium.executablePath());
  if (!installed && strict) {
    throw new Error(
      "Chromium is required when WORKER_INTEGRATION=1: run `playwright install chromium`",
    );
  }
  return installed;
}
