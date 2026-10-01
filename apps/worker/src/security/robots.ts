import robotsParserModule from "robots-parser";
import { followRedirects } from "./redirects.js";
import type { UrlGuard } from "./ssrf.js";

// The package is CommonJS (`module.exports = fn`) but its typings declare an ES
// default export, which NodeNext does not resolve to the function itself.
const robotsParser = robotsParserModule as unknown as (
  url: string,
  robotstxt: string,
) => { isAllowed(url: string, userAgent?: string): boolean | undefined };

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface RobotsOptions {
  userAgent: string;
  fetch: FetchLike;
  // Validates every URL we request, including redirect targets (anti-SSRF).
  guard: UrlGuard;
  timeoutMs?: number;
  maxBytes?: number;
}

export type RobotsDecision =
  { allowed: true } | { allowed: false; reason: string };

const DEFAULT_TIMEOUT_MS = 10_000;
// RFC 9309 asks crawlers to parse at least 500 KiB.
const DEFAULT_MAX_BYTES = 512 * 1024;

async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
  }
  await reader.cancel();
  const merged = Buffer.concat(chunks).subarray(0, maxBytes);
  return new TextDecoder().decode(merged);
}

// RFC 9309: a missing robots.txt (4xx) allows everything, an unreachable one
// (5xx, network error, timeout) forbids everything. We refuse in the second
// case rather than crawl a site that may have asked us not to.
export async function checkRobots(
  page: URL,
  options: RobotsOptions,
): Promise<RobotsDecision> {
  const robotsUrl = new URL("/robots.txt", page.origin).href;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let body: string;
  try {
    const { hop } = await followRedirects(
      robotsUrl,
      async (url) => {
        const response = await options.fetch(url, {
          redirect: "manual",
          headers: { "user-agent": options.userAgent },
          signal: AbortSignal.timeout(timeoutMs),
        });
        return {
          status: response.status,
          location: response.headers.get("location"),
          value: response,
        };
      },
      options.guard,
    );
    const response = hop.value;
    if (response.status >= 400 && response.status < 500)
      return { allowed: true };
    if (response.status < 200 || response.status >= 300) {
      return {
        allowed: false,
        reason: `robots.txt unavailable (HTTP ${response.status})`,
      };
    }
    body = await readCapped(response, maxBytes);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      allowed: false,
      reason: `robots.txt could not be fetched: ${detail}`,
    };
  }

  const robots = robotsParser(robotsUrl, body);
  if (robots.isAllowed(page.href, options.userAgent) === false) {
    return { allowed: false, reason: "disallowed by robots.txt" };
  }
  return { allowed: true };
}
