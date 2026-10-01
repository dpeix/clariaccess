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
