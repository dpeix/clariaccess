import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { UrlNotAllowedError } from "../security/ssrf.js";
import {
  startFixtureServer,
  type FixtureServer,
} from "../test/fixture-server.js";
import { createFetchText } from "./fetch-text.js";

describe("createFetchText", () => {
  let server: FixtureServer;

  beforeAll(async () => {
    server = await startFixtureServer((req, res) => {
      if (req.url === "/ok.xml") {
        res
          .writeHead(200, { "content-type": "application/xml" })
          .end("<urlset/>");
      } else if (req.url === "/big.xml") {
        res.writeHead(200).end("x".repeat(100_000));
      } else if (req.url === "/moved.xml") {
        res.writeHead(301, { location: "/ok.xml" }).end();
      } else if (req.url === "/error.xml") {
        res.writeHead(500).end("oops");
      } else {
        res.writeHead(404).end();
      }
      return true;
    });
  });
  afterAll(async () => {
    await server.close();
  });

  const make = (
    overrides: Partial<Parameters<typeof createFetchText>[0]> = {},
  ) =>
    createFetchText({
      fetch,
      guard: async () => undefined,
      userAgent: "test-bot",
      timeoutMs: 5000,
      maxBytes: 1000,
      ...overrides,
    });

  it("returns the body of a successful response", async () => {
    expect(await make()(new URL(`${server.origin}/ok.xml`))).toBe("<urlset/>");
  });

  it("follows a redirect", async () => {
    expect(await make()(new URL(`${server.origin}/moved.xml`))).toBe(
      "<urlset/>",
    );
  });

  it.each(["/missing.xml", "/error.xml"])(
    "returns null for %s",
    async (path) => {
      expect(await make()(new URL(`${server.origin}${path}`))).toBeNull();
    },
  );

  it("reads at most maxBytes", async () => {
    const body = await make({ maxBytes: 500 })(
      new URL(`${server.origin}/big.xml`),
    );

    expect(body).toHaveLength(500);
  });

  it("sends the crawler user agent", async () => {
    const seen: string[] = [];
    const spy = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get("user-agent") ?? "");
      return fetch(url, init);
    });

    await make({ fetch: spy })(new URL(`${server.origin}/ok.xml`));

    expect(seen).toEqual(["test-bot"]);
  });

  it("refuses an address the guard forbids, without requesting it", async () => {
    server.hits.length = 0;
    const guard = async (url: string) => {
      throw new UrlNotAllowedError(url, "targets a non-public address");
    };

    await expect(
      make({ guard })(new URL(`${server.origin}/ok.xml`)),
    ).rejects.toBeInstanceOf(UrlNotAllowedError);
    expect(server.hits).toEqual([]);
  });
});
