// Files that are not pages: scanning them with a browser is pointless and a
// crawl that followed every download link would burn its budget on them.
const NON_PAGE_EXTENSIONS = new Set([
  "pdf",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "zip",
  "gz",
  "css",
  "js",
  "json",
  "xml",
  "txt",
  "mp3",
  "mp4",
  "webm",
  "woff",
  "woff2",
  "doc",
  "docx",
  "xls",
  "xlsx",
]);

// The page URL as the crawl identifies it, or null when it is out of scope:
// another origin (subdomains and other schemes are other sites), a file that
// is not a page, credentials. The fragment is dropped, the query kept.
export function normalizeCrawlUrl(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  if (url.username !== "" || url.password !== "") return null;
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const dot = lastSegment.lastIndexOf(".");
  if (
    dot >= 0 &&
    NON_PAGE_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase())
  ) {
    return null;
  }
  url.hash = "";
  return url.href;
}

export function crawlableUrls(hrefs: string[], origin: string): string[] {
  const seen = new Set<string>();
  for (const href of hrefs) {
    const normalized = normalizeCrawlUrl(href, origin);
    if (normalized !== null) seen.add(normalized);
  }
  return [...seen];
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

// Pages listed by a sitemap (<urlset>). A sitemap index only points to other
// sitemaps, which we do not follow: the crawl is capped to a few pages anyway.
export function sitemapLocations(xml: string): string[] {
  if (!/<urlset[\s>]/i.test(xml)) return [];
  return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map((match) =>
    match[1]!
      .trim()
      .replace(/&(?:amp|lt|gt|quot|apos);/g, (e) => XML_ENTITIES[e]!),
  );
}
