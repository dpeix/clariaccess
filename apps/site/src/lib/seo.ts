export function pageTitle(title: string | undefined, siteName: string): string {
  return title ? `${title} | ${siteName}` : siteName;
}

// One canonical form per page (directory format, trailing slash) so the same
// page is never indexed under several URLs. Query and fragment are dropped:
// utm parameters must not create duplicates.
export function canonicalUrl(pathname: string, siteUrl: string): string {
  const url = new URL(pathname, siteUrl);
  const lastSegment = url.pathname.split("/").pop() ?? "";
  const path =
    lastSegment.includes(".") || url.pathname.endsWith("/")
      ? url.pathname
      : `${url.pathname}/`;
  return `${url.origin}${path}`;
}

// JSON-LD sits inside <script type="application/ld+json">: a "</script>" in
// the data would end the element and let markup through. U+2028/2029 break
// some parsers.
export function jsonLdScript(data: object): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CONTEXT = "https://schema.org";

export function organizationJsonLd(org: { name: string; url: string }) {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: org.name,
    url: org.url,
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function articleJsonLd(article: {
  headline: string;
  description: string;
  url: string;
  dateModified: string;
  publisher: string;
}) {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: article.headline,
    description: article.description,
    dateModified: article.dateModified,
    mainEntityOfPage: article.url,
    publisher: { "@type": "Organization", name: article.publisher },
  };
}
