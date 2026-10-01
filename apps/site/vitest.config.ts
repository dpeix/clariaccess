import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Builds the site once for the tests that inspect or browse the output.
    globalSetup: ["./src/test/global-setup.ts"],
    testTimeout: 30_000,
  },
});
