// QUEUE_INTEGRATION=1 (set by CI) turns a missing database into a failure.
// Without it, tests that need Postgres skip, so a plain `pnpm test` works on a
// machine that has none.
export function adminDatabaseUrl(): string | undefined {
  const url = process.env["DATABASE_URL"];
  if (url === undefined && process.env["QUEUE_INTEGRATION"] === "1") {
    throw new Error("DATABASE_URL is required when QUEUE_INTEGRATION=1");
  }
  return url;
}
