import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.url(),
  // e.g. smtp://localhost:1025 (Mailpit) in development.
  SMTP_URL: z.url(),
  MAIL_FROM: z.email(),
  // Origin of the public site, used for the report link in emails.
  PUBLIC_SITE_URL: z.url(),
  // Origin of the customer app (apps/app): target of the login link, the only
  // browser origin allowed to use the signed-in API.
  APP_URL: z.url(),
  // Only behind a reverse proxy you control: otherwise X-Forwarded-For is
  // client-supplied and would let anyone dodge the per-IP limit.
  TRUST_PROXY: z.stringbool().default(false),
  RATE_LIMIT_IP_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_IP_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600),
  // Login link requests per IP, over the window below.
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(3600),
  // Multi-page audits per site over 24 hours (customer accounts).
  SITE_DAILY_AUDIT_LIMIT: z.coerce.number().int().positive().default(5),
  // Free audits per domain over 24 hours, whoever asks.
  DOMAIN_DAILY_AUDIT_LIMIT: z.coerce.number().int().positive().default(3),
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
