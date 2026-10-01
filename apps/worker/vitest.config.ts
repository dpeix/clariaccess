import { defineConfig } from "vitest/config";

// Tests run from apps/worker but the shared .env lives at the repo root.
// loadEnvFile never overrides variables already set (e.g. by CI).
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({});
