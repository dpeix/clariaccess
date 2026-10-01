import { describe, expect, it } from "vitest";
import { crawlableUrls, normalizeCrawlUrl, sitemapLocations } from "./urls.js";

const ORIGIN = "https://acme.example";

describe("normalizeCrawlUrl", () => {
  it("keeps a same-origin page and drops the fragment", () => {
    expect(normalizeCrawlUrl("https://acme.example/a#section", ORIGIN)).toBe(
      "https://acme.example/a",
    );
  });

  it("keeps the query string, which often selects the content", () => {
    expect(normalizeCrawlUrl("https://acme.example/a?id=2", ORIGIN)).toBe(
      "https://acme.example/a?id=2",
    );
  });

  it("normalizes the host case and the empty path", () => {
    expect(normalizeCrawlUrl("https://ACME.example", ORIGIN)).toBe(
      "https://acme.example/",
    );
  });

  it.each([
    ["another host", "https://other.example/a"],
    ["a subdomain", "https://blog.acme.example/a"],
    ["another scheme on the same host", "http://acme.example/a"],
    ["another port", "https://acme.example:8443/a"],
    ["a mailto link", "mailto:a@acme.example"],
    ["a javascript link", "javascript:void(0)"],
    ["not a url", "::::"],
    ["credentials", "https://user:pw@acme.example/a"],
  ])("rejects %s", (_label, href) => {
    expect(normalizeCrawlUrl(href, ORIGIN)).toBeNull();
  });

  it.each(["pdf", "jpg", "png", "zip", "css", "js", "xml", "mp4"])(
    "rejects a .%s file, which is not a page",
    (extension) => {
      expect(
        normalizeCrawlUrl(`https://acme.example/file.${extension}`, ORIGIN),
      ).toBeNull();
    },
  );

  it("is not fooled by an extension in the query or a dot in a directory", () => {
    expect(
      normalizeCrawlUrl("https://acme.example/a?f=x.pdf", ORIGIN),
    ).not.toBeNull();
    expect(
      normalizeCrawlUrl("https://acme.example/v1.2/page", ORIGIN),
    ).not.toBeNull();
  });
});

describe("crawlableUrls", () => {
  it("normalizes, deduplicates and keeps the order of first appearance", () => {
    expect(
      crawlableUrls(
        [
          "https://acme.example/b",
          "https://acme.example/a#x",
          "https://acme.example/b#y",
          "https://other.example/c",
          "https://acme.example/a",
        ],
        ORIGIN,
      ),
    ).toEqual(["https://acme.example/b", "https://acme.example/a"]);
  });
});

describe("sitemapLocations", () => {
  it("reads the <loc> entries of a urlset", () => {
    const xml = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://acme.example/a</loc></url>
      <url><loc> https://acme.example/b </loc><lastmod>2026-01-01</lastmod></url></urlset>`;

    expect(sitemapLocations(xml)).toEqual([
      "https://acme.example/a",
      "https://acme.example/b",
    ]);
  });

  it("decodes XML entities in urls", () => {
    expect(
      sitemapLocations(
        "<urlset><url><loc>https://a.example/?x=1&amp;y=2</loc></url></urlset>",
      ),
    ).toEqual(["https://a.example/?x=1&y=2"]);
  });

  it("ignores a sitemap index: nested sitemaps are not pages", () => {
    expect(
      sitemapLocations(
        "<sitemapindex><sitemap><loc>https://a.example/s1.xml</loc></sitemap></sitemapindex>",
      ),
    ).toEqual([]);
  });

  it("returns nothing for text that is not a sitemap", () => {
    expect(sitemapLocations("<html><body>404</body></html>")).toEqual([]);
    expect(sitemapLocations("")).toEqual([]);
  });
});
