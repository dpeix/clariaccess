import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // VITE_* settings come from the root .env, shared with the other apps.
  envDir: "../..",
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Builds the app once for the tests that browse it.
    globalSetup: ["./src/test/global-setup.ts"],
    testTimeout: 30_000,
  },
});
