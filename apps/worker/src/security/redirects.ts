import type { UrlGuard } from "./ssrf.js";

export class TooManyRedirectsError extends Error {
  constructor(start: string) {
    super(`Too many redirects from ${start}`);
    this.name = "TooManyRedirectsError";
  }
}

// One response of a chain, with the redirect target already extracted so the
// helper works with both fetch() and Playwright responses.
export interface Hop<R> {
  status: number;
  location: string | null;
  value: R;
}

const MAX_REDIRECTS = 5;

// Follows redirects ourselves, one hop at a time, so that every URL in the
// chain goes through the guard before a request is made to it. Browsers and
// HTTP clients following redirects on their own would skip that check.
export async function followRedirects<R>(
  start: string,
  request: (url: string) => Promise<Hop<R>>,
  guard: UrlGuard,
): Promise<{ finalUrl: string; hop: Hop<R> }> {
  let url = start;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await guard(url);
    const hop = await request(url);
    const isRedirect = hop.status >= 300 && hop.status < 400;
    if (!isRedirect || hop.location === null) return { finalUrl: url, hop };
    url = new URL(hop.location, url).href;
  }
  throw new TooManyRedirectsError(start);
}
