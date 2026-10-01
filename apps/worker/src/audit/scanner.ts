import { AxeBuilder } from "@axe-core/playwright";
import type { Result } from "axe-core";
import type { Browser, BrowserContext } from "playwright";
import { followRedirects } from "../security/redirects.js";
import {
  UrlNotAllowedError,
  assertPublicUrl,
  type UrlGuard,
} from "../security/ssrf.js";

export class ScanTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Scan exceeded ${timeoutMs} ms`);
    this.name = "ScanTimeoutError";
  }
}

export interface ScanOptions {
  userAgent: string;
  timeoutMs: number;
  // Defaults to the public-internet-only guard. Only tests override it, to
  // reach a fixture server on loopback: never wire it to configuration.
  guard?: UrlGuard;
}

export interface ScanResult {
  violations: Result[];
  axeVersion: string;
  finalUrl: string;
  // Requests the guard refused (subresources only: a refused document throws).
  blockedRequests: string[];
}

export type Scan = (url: URL) => Promise<ScanResult>;

const defaultGuard: UrlGuard = (url) => assertPublicUrl(url);

// The page may already be gone when a late request is answered (timeout,
// context closed): a failed reply then has nobody left to report to.
async function settle(reply: () => Promise<void>): Promise<void> {
  try {
    await reply();
  } catch {
    // Intentionally ignored, see above.
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ScanTimeoutError(timeoutMs)),
      timeoutMs,
    );
  });
  // The loser of the race must not surface as an unhandled rejection.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createScanner(browser: Browser, options: ScanOptions): Scan {
  const guard = options.guard ?? defaultGuard;
  const userAgent = options.userAgent;

  return async (url) => {
    const opened: BrowserContext[] = [];
    try {
      return await withTimeout(scanOnce(url, opened), options.timeoutMs);
    } finally {
      // Closed here rather than inside scanOnce: after a timeout scanOnce may
      // never settle (frozen page), and its context must not outlive the scan.
      await Promise.all(opened.map((context) => context.close()));
    }
  };

  async function scanOnce(
    url: URL,
    opened: BrowserContext[],
  ): Promise<ScanResult> {
    const blockedRequests: string[] = [];
    // One verdict per host and scan: pages issue hundreds of requests.
    const verdicts = new Map<string, Promise<unknown>>();
    const scanGuard: UrlGuard = (target) => {
      const host = new URL(target).host;
      let verdict = verdicts.get(host);
      if (verdict === undefined) {
        verdict = guard(target);
        verdicts.set(host, verdict);
      }
      return verdict;
    };

    // Chromium follows redirects without telling page.route() about the
    // hops after the first, so redirects are resolved here, guarded hop by
    // hop, and the browser is only ever pointed at the final URL.
    const { finalUrl: resolvedUrl } = await followRedirects(
      url.href,
      async (target) => {
        const response = await fetch(target, {
          redirect: "manual",
          headers: { "user-agent": userAgent },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
        await response.body?.cancel();
        return {
          status: response.status,
          location: response.headers.get("location"),
          value: undefined,
        };
      },
      scanGuard,
    );

    const context = await browser.newContext({
      userAgent,
      serviceWorkers: "block",
      acceptDownloads: false,
    });
    opened.push(context);

    const page = await context.newPage();
    let documentRedirected = false;

    await page.route("**/*", async (route) => {
      const request = route.request();
      // data:/blob: never leave the browser.
      if (!/^https?:/i.test(request.url())) {
        return settle(() => route.continue());
      }
      const isDocument =
        request.isNavigationRequest() && request.frame() === page.mainFrame();
      try {
        const { finalUrl, hop } = await followRedirects(
          request.url(),
          async (target) => {
            const response = await route.fetch({
              url: target,
              maxRedirects: 0,
              timeout: options.timeoutMs,
            });
            return {
              status: response.status(),
              location: response.headers()["location"] ?? null,
              value: response,
            };
          },
          scanGuard,
        );
        // The URL was resolved above; a document that now redirects
        // elsewhere is unstable (or hostile): refuse rather than follow.
        if (isDocument && finalUrl !== request.url()) {
          documentRedirected = true;
          return settle(() => route.abort("failed"));
        }
        return await settle(() => route.fulfill({ response: hop.value }));
      } catch (error) {
        if (error instanceof UrlNotAllowedError) {
          blockedRequests.push(error.target);
          return settle(() => route.abort("blockedbyclient"));
        }
        return settle(() => route.abort("failed"));
      }
    });

    try {
      await page.goto(resolvedUrl, {
        waitUntil: "load",
        timeout: options.timeoutMs,
      });
    } catch (error) {
      if (documentRedirected) {
        throw new Error(`Page redirected after resolution: ${resolvedUrl}`);
      }
      throw error;
    }

    const axe = await new AxeBuilder({ page }).analyze();
    return {
      violations: axe.violations,
      axeVersion: axe.testEngine.version,
      finalUrl: page.url(),
      blockedRequests,
    };
  }
}
