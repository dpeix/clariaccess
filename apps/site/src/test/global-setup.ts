import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    distDir: string;
  }
}

export const TEST_SITE_URL = "https://www.example.fr";
// Never resolves: the browser tests intercept every request to it.
export const TEST_API_URL = "http://api.test";

const siteRoot = fileURLToPath(new URL("../../", import.meta.url));

// A temporary output directory, so the tests neither depend on nor clobber
// `dist/` (turbo caches it) and always check the current sources.
export default function setup(project: TestProject): () => void {
  const distDir = mkdtempSync(join(tmpdir(), "site-dist-"));
  const astroBin = join(
    dirname(createRequire(import.meta.url).resolve("astro/package.json")),
    "bin/astro.mjs",
  );
  try {
    execFileSync(process.execPath, [astroBin, "build", "--outDir", distDir], {
      cwd: siteRoot,
      // SITE_ENV is not "production": the legal placeholders must not fail
      // this build (the dedicated test below covers that gate).
      env: {
        ...process.env,
        PUBLIC_SITE_URL: TEST_SITE_URL,
        PUBLIC_API_URL: TEST_API_URL,
        SITE_ENV: "test",
      },
      stdio: "pipe",
    });
  } catch (error) {
    rmSync(distDir, { recursive: true, force: true });
    const output = (error as { stderr?: Buffer }).stderr?.toString() ?? "";
    throw new Error(`astro build failed:\n${output}`, { cause: error });
  }
  project.provide("distDir", distDir);
  return () => rmSync(distDir, { recursive: true, force: true });
}
