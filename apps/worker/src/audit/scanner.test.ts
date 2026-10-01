import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UrlNotAllowedError } from "../security/ssrf.js";
import { chromiumAvailable } from "../test/integration.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../test/fixture-server.js";
import { ScanTimeoutError, createScanner } from "./scanner.js";

// The fixture server lives on 127.0.0.1, which the default guard forbids.
const allowFixtureHost = (allowedHost: string) => async (url: string) => {
  if (new URL(url).hostname !== allowedHost) throw new UrlNotAllowedError(url);
};

describe.skipIf(!chromiumAvailable())("createScanner (Chromium)", () => {
  let browser: Browser;
  let server: FixtureServer;

  beforeAll(async () => {
    browser = await chromium.launch();
    server = await startFixtureServer(async (req, res, origin) => {
      const path = new URL(req.url ?? "/", origin).pathname;
      if (path === "/hang") return true; // never answers
      if (path === "/redirect-out") {
        res.writeHead(302, { location: "http://127.0.0.2:8080/secret" }).end();
        return true;
      }
      if (path === "/busy") {
        // Loads fine, then freezes the page: only axe hangs.
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>t</h1></main><script>addEventListener("load", () => setTimeout(() => { for (;;) {} }, 0))</script></body></html>`,
        );
        return true;
      }
      if (path === "/links.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>t</h1>
          <a href="/a">a</a> <a href="/a">a again</a> <a href="b?x=1#frag">b</a>
          <a href="https://other.example/x">external</a> <a href="mailto:x@y.fr">mail</a>
          <a href="javascript:void(0)">js</a> <a href="#top">top</a> <a>no href</a>
          <script>document.body.insertAdjacentHTML("beforeend", '<a href="/late">late</a>')</script>
          </main></body></html>`,
        );
        return true;
      }
      if (path === "/redirect-ok") {
        res.writeHead(302, { location: "/clean.html" }).end();
        return true;
      }
      if (path === "/img-redirect") {
        res
          .writeHead(302, { location: "http://127.0.0.2:8080/leak.png" })
          .end();
        return true;
      }
      if (path === "/redirect-subresource.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><img src="/img-redirect" alt="x"></main></body></html>`,
        );
        return true;
      }
      if (path === "/subresource.html") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(
          `<!doctype html><html lang="fr"><head><title>t</title></head><body><main><h1>t</h1><img src="http://127.0.0.2:8080/internal.png" alt="x"></main></body></html>`,
        );
        return true;
      }
      return false;
    });
  });

  afterAll(async () => {
    await browser.close();
    await server.close();
  });

  const options = {
    userAgent: "ClariAccessBot",
    timeoutMs: 15_000,
    guard: allowFixtureHost("127.0.0.1"),
  };

  it("reports the http(s) links of the rendered page, absolute and without duplicates", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(new URL(`${server.origin}/links.html`));

    expect(result.links.slice().sort()).toEqual(
      [
        `${server.origin}/a`,
        `${server.origin}/b?x=1#frag`,
        `${server.origin}/links.html#top`,
        `${server.origin}/late`,
        "https://other.example/x",
      ].sort(),
    );
  });

  it("reports the known violations of a fixture page", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(new URL(`${server.origin}/violations.html`));
    const ids = result.violations.map((v) => v.id);
    expect(ids).toEqual(
      expect.arrayContaining(["image-alt", "button-name", "color-contrast"]),
    );
    expect(result.axeVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(result.finalUrl).toBe(`${server.origin}/violations.html`);
  });

  it("reports nothing on an accessible page", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(new URL(`${server.origin}/clean.html`));
    expect(result.violations).toEqual([]);
  });

  it("blocks subresources the guard refuses and still scans the page", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(new URL(`${server.origin}/subresource.html`));
    expect(result.blockedRequests).toEqual([
      "http://127.0.0.2:8080/internal.png",
    ]);
  });

  it("follows a legitimate redirect and scans the final page", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(new URL(`${server.origin}/redirect-ok`));
    expect(result.finalUrl).toBe(`${server.origin}/clean.html`);
    expect(result.violations).toEqual([]);
  });

  it("blocks a subresource that redirects to a forbidden address", async () => {
    const scan = createScanner(browser, options);
    const result = await scan(
      new URL(`${server.origin}/redirect-subresource.html`),
    );
    expect(result.blockedRequests).toEqual(["http://127.0.0.2:8080/leak.png"]);
  });

  it("refuses a redirect to a forbidden address", async () => {
    const scan = createScanner(browser, options);
    await expect(
      scan(new URL(`${server.origin}/redirect-out`)),
    ).rejects.toThrow(UrlNotAllowedError);
  });

  it("blocks loopback targets by default, before any request is made", async () => {
    const before = server.hits.length;
    const scan = createScanner(browser, {
      userAgent: options.userAgent,
      timeoutMs: options.timeoutMs,
    });
    await expect(
      scan(new URL(`${server.origin}/violations.html`)),
    ).rejects.toThrow(UrlNotAllowedError);
    expect(server.hits.length).toBe(before);
  });

  it("gives up on a page that never answers", async () => {
    const scan = createScanner(browser, { ...options, timeoutMs: 500 });
    await expect(scan(new URL(`${server.origin}/hang`))).rejects.toThrow(
      ScanTimeoutError,
    );
    // The browser context must not outlive the scan, even on timeout.
    expect(browser.contexts()).toEqual([]);
  });

  it("closes the browser context when the page freezes mid-analysis", async () => {
    const scan = createScanner(browser, { ...options, timeoutMs: 3000 });
    await expect(scan(new URL(`${server.origin}/busy`))).rejects.toThrow(
      ScanTimeoutError,
    );
    expect(browser.contexts()).toEqual([]);
  });
});
