import { fileURLToPath } from "node:url";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

// PUBLIC_* variables come from the root .env in development (the same file
// the API reads) and from the real environment in CI and production.
try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  output: "static",
  // Matches canonicalUrl(): one URL per page.
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    mdx(),
    // Result pages are private (unguessable id) and noindex.
    sitemap({
      filter: (page) => !new URL(page).pathname.startsWith("/audit/"),
    }),
  ],
});
