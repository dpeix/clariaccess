import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize } from "node:path";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Page } from "playwright";
import { expect } from "vitest";

// SITE_INTEGRATION=1 (set by the dedicated CI job) turns a missing browser
// into a failure. Without it the browser tests skip, so a plain `pnpm test`
// works on a machine without Chromium.
const strict = process.env["SITE_INTEGRATION"] === "1";

export function chromiumAvailable(): boolean {
  const installed = existsSync(chromium.executablePath());
  if (!installed && strict) {
    throw new Error(
      "Chromium is required when SITE_INTEGRATION=1: run `playwright install chromium`",
    );
  }
  return installed;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

export interface StaticServer {
  origin: string;
  close: () => Promise<void>;
}

// Serves the built site like a static host would: /dir/ -> /dir/index.html.
export async function serveDist(distDir: string): Promise<StaticServer> {
  const server: Server = createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://static").pathname,
    );
    const target = normalize(join(distDir, pathname));
    const file = pathname.endsWith("/") ? join(target, "index.html") : target;
    if (
      !file.startsWith(distDir) ||
      !existsSync(file) ||
      !statSync(file).isFile()
    ) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    });
    res.end(readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

// WCAG 2.0/2.1 A and AA: the level the EAA (EN 301 549) and the RGAA require.
export async function axeViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`,
  );
}

export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export type ApiHandler = (call: ApiCall) => {
  status: number;
  body?: unknown;
};

// Stands in for the API: the site is built against an unresolvable host and
// every request to it is answered here (CORS included).
export async function mockApi(
  page: Page,
  apiUrl: string,
  handler: ApiHandler,
): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST",
  };
  await page.route(`${apiUrl}/**`, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    const call: ApiCall = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: request.postData() === null ? undefined : request.postDataJSON(),
    };
    calls.push(call);
    const reply = handler(call);
    await route.fulfill({
      status: reply.status,
      headers: cors,
      contentType: "application/json",
      body: reply.body === undefined ? "" : JSON.stringify(reply.body),
    });
  });
  return calls;
}

// Retries until the page catches up (rendering follows async fetches), unlike
// a plain expect which would read the DOM once.
export function eventually<T>(read: () => Promise<T>, timeoutMs = 5000) {
  return expect.poll(read, { timeout: timeoutMs, interval: 50 });
}
