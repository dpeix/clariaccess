import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findPlaceholders, legal } from "./legal.js";

const siteRoot = fileURLToPath(new URL("../", import.meta.url));
const astroBin = join(
  dirname(createRequire(import.meta.url).resolve("astro/package.json")),
  "bin/astro.mjs",
);

function productionBuild(): { ok: boolean; output: string } {
  const outDir = mkdtempSync(join(tmpdir(), "site-prod-"));
  try {
    const output = execFileSync(
      process.execPath,
      [astroBin, "build", "--outDir", outDir],
      {
        cwd: siteRoot,
        env: {
          ...process.env,
          PUBLIC_SITE_URL: "https://www.example.fr",
          PUBLIC_API_URL: "https://api.example.fr",
          SITE_ENV: "production",
        },
        stdio: "pipe",
      },
    ).toString();
    return { ok: true, output };
  } catch (error) {
    const { stdout, stderr } = error as { stdout: Buffer; stderr: Buffer };
    return { ok: false, output: `${stdout}${stderr}` };
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}

describe("production build and legal information", () => {
  // While src/legal.ts has placeholders the build must fail; once they are
  // filled in it must succeed. Both outcomes are checked, so filling the
  // values in does not break the suite.
  it("refuses to build while src/legal.ts has placeholders", () => {
    const missing = findPlaceholders(legal);
    const result = productionBuild();

    if (missing.length > 0) {
      expect(result.ok).toBe(false);
      expect(result.output).toContain(
        "Legal information still to be filled in",
      );
      expect(result.output).toContain(missing[0]);
    } else {
      expect(result.ok).toBe(true);
    }
  });
});
