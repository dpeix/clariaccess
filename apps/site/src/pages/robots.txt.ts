import type { APIRoute } from "astro";

// Generated (not a static file) because the sitemap line needs the absolute
// site URL. Result pages are also noindex; this keeps crawlers off them.
export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("sitemap-index.xml", site).href;
  return new Response(
    `User-agent: *\nDisallow: /audit/\n\nSitemap: ${sitemap}\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
};
