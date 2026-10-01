import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  // Wall-clock budget for one audit (robots.txt excluded), navigation and axe included.
  AUDIT_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  // Issues beyond this are dropped; keeps one hostile page from filling the database.
  AUDIT_MAX_ISSUES: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(2000),
  // Pages scanned per multi-page audit, home page included.
  CRAWL_MAX_PAGES: z.coerce.number().int().positive().max(100).default(25),
  // Time after which the pages of an audit still waiting are abandoned.
  CRAWL_MAX_DURATION_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 60 * 1000),
  // How often the scheduler looks for re-scans that came due (cron, UTC). The
  // delay of a re-scan is at most this interval.
  SCAN_TICK_CRON: z.string().min(1).default("*/5 * * * *"),
  // Re-scans started per tick; the rest wait for the next one.
  SCAN_TICK_BATCH: z.coerce.number().int().positive().max(200).default(20),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
