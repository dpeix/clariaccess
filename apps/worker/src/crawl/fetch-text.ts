import { followRedirects } from "../security/redirects.js";
import { readCapped, type FetchLike } from "../security/robots.js";
import type { UrlGuard } from "../security/ssrf.js";

export interface FetchTextOptions {
  fetch: FetchLike;
  // Checked before every request, redirects included (anti-SSRF).
  guard: UrlGuard;
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
}

// GET of a text resource on a customer's site (the sitemap): redirects are
// followed hop by hop through the guard, the body is capped, and anything but
// a 2xx answer is null. A refused address throws, so callers can tell it apart.
export function createFetchText(options: FetchTextOptions) {
  return async (url: URL): Promise<string | null> => {
    const { hop } = await followRedirects(
      url.href,
      async (target) => {
        const response = await options.fetch(target, {
          redirect: "manual",
          headers: { "user-agent": options.userAgent },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        return {
          status: response.status,
          location: response.headers.get("location"),
          value: response,
        };
      },
      options.guard,
    );
    if (hop.status < 200 || hop.status >= 300) {
      await hop.value.body?.cancel();
      return null;
    }
    return readCapped(hop.value, options.maxBytes);
  };
}
