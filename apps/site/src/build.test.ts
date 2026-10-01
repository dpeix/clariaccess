import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, inject, it } from "vitest";
import {
  attr,
  jsonLd,
  listPages,
  metaContent,
  resolvesToFile,
  tags,
  type Page,
} from "./test/dist.js";
import { TEST_SITE_URL } from "./test/global-setup.js";

const distDir = inject("distDir");
let pages: Page[] = [];
beforeAll(() => {
  pages = listPages(distDir);
});

const indexable = () => pages.filter((p) => p.route !== "/audit/");

describe("built pages", () => {
  it("includes the pages the plan calls for", () => {
    const routes = pages.map((p) => p.route);
    for (const route of [
      "/",
      "/audit/",
      "/suis-je-concerne/",
      "/guides/",
      "/guides/eaa/",
      "/guides/rgaa/",
      "/guides/modele-declaration-accessibilite/",
      "/mentions-legales/",
      "/confidentialite/",
      "/accessibilite/",
      "/plan-du-site/",
    ]) {
      expect(routes, route).toContain(route);
    }
    expect(routes.filter((r) => r.startsWith("/guides/secteurs/")).length).toBe(
      3,
    );
  });

  it("declares French, one title, one h1 and a description on every page", () => {
    for (const { route, html } of pages) {
      expect(html, route).toMatch(/<html lang="fr"/);
      expect(tags(html, "title").length, `${route} title`).toBe(1);
      expect(html.match(/<h1\b/g)?.length, `${route} h1`).toBe(1);
      const description = metaContent(html, "description");
      expect(description?.length ?? 0, `${route} description`).toBeGreaterThan(
        20,
      );
      expect(description!.length, `${route} description`).toBeLessThanOrEqual(
        160,
      );
    }
  });

  it("gives every page a distinct title and description", () => {
    const titles = pages.map((p) => /<title>([^<]*)<\/title>/.exec(p.html)![1]);
    const descriptions = pages.map((p) => metaContent(p.html, "description"));
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
  });

  it("has a self-referencing canonical on the site origin", () => {
    for (const { route, html } of pages) {
      const canonical = tags(html, "link").find(
        (t) => attr(t, "rel") === "canonical",
      );
      expect(attr(canonical ?? "", "href"), route).toBe(
        `${TEST_SITE_URL}${route}`,
      );
    }
  });

  it("embeds parsable structured data on indexable pages only", () => {
    for (const { route, html } of indexable()) {
      const data = jsonLd(html) as { "@type": string }[];
      expect(
        data.map((d) => d["@type"]),
        route,
      ).toContain("Organization");
    }
    const audit = pages.find((p) => p.route === "/audit/")!;
    expect(jsonLd(audit.html)).toEqual([]);
  });

  it("marks guides with Article and breadcrumb data", () => {
    const guide = pages.find((p) => p.route === "/guides/eaa/")!;
    const types = (jsonLd(guide.html) as { "@type": string }[]).map(
      (d) => d["@type"],
    );
    expect(types).toEqual(
      expect.arrayContaining(["Article", "BreadcrumbList"]),
    );
  });

  it("keeps the audit result page out of search engines", () => {
    const audit = pages.find((p) => p.route === "/audit/")!;
    expect(metaContent(audit.html, "robots")).toBe("noindex, nofollow");
    for (const { route, html } of indexable()) {
      expect(metaContent(html, "robots"), route).toBeUndefined();
    }
  });

  it("offers a skip link and landmarks", () => {
    for (const { route, html } of pages) {
      expect(html, route).toContain('href="#contenu"');
      expect(html, route).toContain('id="contenu"');
      expect(html, route).toMatch(/<header\b/);
      expect(html, route).toMatch(/<main\b/);
      expect(html, route).toMatch(/<footer\b/);
    }
  });
});

describe("sitemap and robots.txt", () => {
  const sitemap = () =>
    readdirSync(distDir)
      .filter((f) => /^sitemap-\d+\.xml$/.test(f))
      .map((f) => readFileSync(join(distDir, f), "utf8"))
      .join("\n");

  it("lists every indexable page and not the result page", () => {
    const xml = sitemap();
    for (const { route } of indexable()) {
      expect(xml, route).toContain(`<loc>${TEST_SITE_URL}${route}</loc>`);
    }
    expect(xml).not.toContain("/audit/");
  });

  it("points crawlers to the sitemap and away from results", () => {
    const robots = readFileSync(join(distDir, "robots.txt"), "utf8");
    expect(robots).toContain("Disallow: /audit/");
    expect(robots).toContain(`Sitemap: ${TEST_SITE_URL}/sitemap-index.xml`);
    expect(readFileSync(join(distDir, "sitemap-index.xml"), "utf8")).toContain(
      "sitemap-0.xml",
    );
  });
});

describe("links and resources", () => {
  it("has no internal link or local resource pointing at a missing file", () => {
    const broken: string[] = [];
    for (const { route, html } of pages) {
      const urls = [...html.matchAll(/\b(?:href|src)="(\/[^"]*)"/g)].map(
        (m) => m[1]!,
      );
      for (const url of urls) {
        if (!resolvesToFile(distDir, url)) broken.push(`${route} -> ${url}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("loads no third-party script, style or font", () => {
    for (const { route, html } of pages) {
      for (const tag of [...tags(html, "script"), ...tags(html, "link")]) {
        if (attr(tag, "rel") === "canonical") continue;
        const url = attr(tag, "src") ?? attr(tag, "href");
        expect(url ?? "/", `${route} ${tag}`).not.toMatch(/^(https?:)?\/\//);
      }
    }
  });
});

// A budget guards against silent bloat; the figures leave room to grow and
// are the thing to revisit, not to silence, when a test fails.
const BUDGET_GZIP_BYTES = 60_000;

describe("page weight", () => {
  it(`keeps html, css and scripts under ${BUDGET_GZIP_BYTES} bytes gzipped per page`, () => {
    for (const { route, html } of pages) {
      const assets = [
        ...html.matchAll(/(?:href|src)="(\/_astro\/[^"]+\.(?:css|js))"/g),
      ].map((m) => readFileSync(join(distDir, m[1]!)));
      const total = [Buffer.from(html), ...assets].reduce(
        (sum, buffer) => sum + gzipSync(buffer).length,
        0,
      );
      expect(total, route).toBeLessThan(BUDGET_GZIP_BYTES);
    }
  });
});
