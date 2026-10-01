import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface Page {
  // URL path, e.g. "/guides/eaa/".
  route: string;
  html: string;
}

export function listPages(distDir: string): Page[] {
  const pages: Page[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "index.html") {
        const folder = relative(distDir, dir).split(sep).join("/");
        pages.push({
          route: folder === "" ? "/" : `/${folder}/`,
          html: readFileSync(full, "utf8"),
        });
      }
    }
  };
  walk(distDir);
  return pages.sort((a, b) => a.route.localeCompare(b.route));
}

export function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
}

export function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "g"))].map(
    (match) => match[0],
  );
}

export function metaContent(html: string, key: string): string | undefined {
  const tag = tags(html, "meta").find(
    (t) => attr(t, "name") === key || attr(t, "property") === key,
  );
  return tag === undefined ? undefined : attr(tag, "content");
}

export function jsonLd(html: string): unknown[] {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => JSON.parse(match[1]!) as unknown);
}

// Whether an internal URL path points at a file the build produced.
export function resolvesToFile(distDir: string, path: string): boolean {
  const clean = decodeURIComponent(path.split(/[?#]/)[0]!);
  const target = join(distDir, clean);
  if (clean.endsWith("/")) return existsSync(join(target, "index.html"));
  return existsSync(target) && statSync(target).isFile();
}
