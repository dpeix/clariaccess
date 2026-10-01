import { describe, expect, it } from "vitest";
import { checkRobots, type RobotsOptions } from "./robots.js";
import { UrlNotAllowedError } from "./ssrf.js";

const UA = "ClariAccessBot";

function textResponse(body: string, status = 200, headers = {}): Response {
  return new Response(body, { status, headers });
}

function options(
  handler: (url: string) => Response | Promise<Response>,
  overrides: Partial<RobotsOptions> = {},
): RobotsOptions {
  return {
    userAgent: UA,
    fetch: async (input) => handler(String(input)),
    guard: async () => undefined,
    ...overrides,
  };
}

const page = new URL("https://example.com/private/page");

describe("checkRobots", () => {
  it("requests /robots.txt at the origin of the page", async () => {
    const seen: string[] = [];
    await checkRobots(
      page,
      options((url) => {
        seen.push(url);
        return textResponse("");
      }),
    );
    expect(seen).toEqual(["https://example.com/robots.txt"]);
  });

  it("allows the page when no rule matches", async () => {
    const result = await checkRobots(
      page,
      options(() => textResponse("User-agent: *\nDisallow: /admin")),
    );
    expect(result).toEqual({ allowed: true });
  });

  it("refuses a page disallowed for our user agent", async () => {
    const result = await checkRobots(
      page,
      options(() => textResponse(`User-agent: ${UA}\nDisallow: /private/`)),
    );
    expect(result.allowed).toBe(false);
  });

  it("refuses a page disallowed for every user agent", async () => {
    const result = await checkRobots(
      page,
      options(() => textResponse("User-agent: *\nDisallow: /")),
    );
    expect(result.allowed).toBe(false);
  });

  it("allows everything when robots.txt does not exist (4xx)", async () => {
    for (const status of [404, 410, 403]) {
      const result = await checkRobots(
        page,
        options(() => textResponse("nope", status)),
      );
      expect(result, `status ${status}`).toEqual({ allowed: true });
    }
  });

  it("refuses when robots.txt is unavailable (5xx), as RFC 9309 requires", async () => {
    const result = await checkRobots(
      page,
      options(() => textResponse("", 503)),
    );
    expect(result.allowed).toBe(false);
  });

  it("refuses when robots.txt cannot be fetched", async () => {
    const result = await checkRobots(
      page,
      options(() => {
        throw new TypeError("network down");
      }),
    );
    expect(result.allowed).toBe(false);
  });

  it("follows redirects and checks every hop with the guard", async () => {
    const guarded: string[] = [];
    const result = await checkRobots(
      page,
      options(
        (url) =>
          url === "https://example.com/robots.txt"
            ? textResponse("", 301, {
                location: "https://www.example.com/robots.txt",
              })
            : textResponse("User-agent: *\nDisallow: /private/"),
        {
          guard: async (url) => {
            guarded.push(url);
          },
        },
      ),
    );
    expect(result.allowed).toBe(false);
    expect(guarded).toEqual([
      "https://example.com/robots.txt",
      "https://www.example.com/robots.txt",
    ]);
  });

  it("refuses when a redirect leads to a forbidden address", async () => {
    const result = await checkRobots(
      page,
      options(
        () =>
          textResponse("", 302, {
            location: "http://169.254.169.254/robots.txt",
          }),
        {
          guard: async (url) => {
            if (url.includes("169.254")) throw new UrlNotAllowedError(url);
          },
        },
      ),
    );
    expect(result.allowed).toBe(false);
  });

  it("gives up on redirect loops", async () => {
    const result = await checkRobots(
      page,
      options(() =>
        textResponse("", 302, { location: "https://example.com/robots.txt" }),
      ),
    );
    expect(result.allowed).toBe(false);
  });

  it("only parses the first maxBytes of a huge file", async () => {
    const huge = `User-agent: *\nAllow: /\n${"# padding\n".repeat(100_000)}Disallow: /private/\n`;
    const result = await checkRobots(
      page,
      options(() => textResponse(huge), { maxBytes: 1024 }),
    );
    // The Disallow line sits past the cap and is ignored, not an error.
    expect(result).toEqual({ allowed: true });
  });
});
