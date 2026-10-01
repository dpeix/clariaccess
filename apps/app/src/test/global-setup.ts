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

// Never resolves: the browser tests intercept every request to it.
export const TEST_API_URL = "http://api.test";

const appRoot = fileURLToPath(new URL("../../", import.meta.url));

// Builds the app once, into a temporary directory, for the browser tests.
export default function setup(project: TestProject): () => void {
  const distDir = mkdtempSync(join(tmpdir(), "app-dist-"));
  const viteBin = join(
    dirname(createRequire(import.meta.url).resolve("vite/package.json")),
    "bin/vite.js",
  );
  try {
    execFileSync(
      process.execPath,
      [viteBin, "build", "--outDir", distDir, "--emptyOutDir"],
      {
        cwd: appRoot,
        env: { ...process.env, VITE_API_URL: TEST_API_URL },
        stdio: "pipe",
      },
    );
  } catch (error) {
    rmSync(distDir, { recursive: true, force: true });
    const { stdout, stderr } = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(`vite build failed:\n${stdout ?? ""}${stderr ?? ""}`, {
      cause: error,
    });
  }
  project.provide("distDir", distDir);
  return () => rmSync(distDir, { recursive: true, force: true });
}
