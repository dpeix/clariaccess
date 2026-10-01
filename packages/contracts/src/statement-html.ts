import { t, type Locale } from "./i18n.js";

// The public accessibility statement as a complete HTML page. Pure and
// dependency-free: the API serves it and the worker prints it to PDF, so both
// say exactly the same thing.
//
// Everything that comes from a person or from the audited site is escaped, and
// an address only becomes a link when it is http(s) (or mailto for the
// publisher's email): the page runs no script and loads nothing.

export interface PublicStatementView {
  locale: Locale;
  siteUrl: string;
  entityName: string;
  version: number;
  publishedAt: string;
  declaredStatus: "total" | "partiel" | "non";
  rate: number | null;
  referentialVersion: string;
  counts: {
    conforme: number;
    nonConforme: number;
    na: number;
    aVerifier: number;
  };
  nonAccessible: {
    criterionId: string;
    title: string;
    sources: ("manual" | "auto")[];
    notes: string;
  }[];
  derogations: string | null;
  technologies: string;
  testEnvironment: string;
  tools: string;
  samplePages: string[];
  contactEmail: string | null;
  contactUrl: string | null;
  pdfPath: string | null;
  // Set on a version that has been replaced: the path of the current one, or ""
  // when it cannot be told.
  supersededBy: string | null;
}

const escape = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

// A link to an address we may follow, plain text otherwise.
const linkOrText = (value: string): string =>
  isHttpUrl(value)
    ? `<a href="${escape(new URL(value).href)}">${escape(value)}</a>`
    : escape(value);

// Same-site absolute paths only (our own /d/... pages).
const isLocalPath = (value: string): boolean =>
  /^\/d\/[a-z0-9]+(\/pdf)?$/.test(value);

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

// The date a reader in France sees: a statement published just after midnight
// in Paris must not carry the previous day.
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeZone: "Europe/Paris",
  }).format(new Date(iso));
}

const STYLE = `
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1a1a1a; background: #ffffff; margin: 0; }
  main, footer { max-width: 52rem; margin: 0 auto; padding: 0 1rem; }
  main { padding-top: 1.5rem; padding-bottom: 1.5rem; }
  h1, h2 { line-height: 1.25; }
  a { color: #0b4fb3; }
  a:focus-visible { outline: 3px solid #b35a00; outline-offset: 2px; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  caption { text-align: left; font-weight: 600; padding-bottom: 0.5rem; }
  th, td { border: 1px solid #8a94a6; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  td { overflow-wrap: anywhere; }
  th { overflow-wrap: break-word; }
  th[scope="row"] { white-space: nowrap; }
  th { background: #f3f6fb; }
  td.notes { white-space: pre-wrap; }
  p, li { overflow-wrap: anywhere; }
  .notice { background: #f3f6fb; border-left: 4px solid #0b3a75; padding: 0.75rem 1rem; }
  footer { border-top: 1px solid #8a94a6; color: #4a4a4a; padding-top: 1rem; padding-bottom: 2rem; }
  @media print { a { color: inherit; } }
`;

export function renderStatementHtml(view: PublicStatementView): string {
  const l = view.locale;
  const site = view.siteUrl;
  const entity = view.entityName;

  const levelText = t(l, `level.${view.declaredStatus}`);
  const results: string[] = [];
  if (view.rate !== null) {
    results.push(
      `<p>${escape(
        t(l, "statement.results.rate", {
          rate: view.rate,
          version: view.referentialVersion,
        }),
      )} ${escape(t(l, "statement.results.rounded"))}</p>`,
    );
  }
  results.push(
    `<p>${escape(
      t(l, "statement.results.counts", {
        conforme: view.counts.conforme,
        nonConforme: view.counts.nonConforme,
        na: view.counts.na,
      }),
    )}</p>`,
  );

  const sourceLabel = (source: "manual" | "auto") =>
    t(
      l,
      source === "manual"
        ? "statement.nonaccessible.source.manual"
        : "statement.nonaccessible.source.auto",
    );
  const nonAccessible =
    view.nonAccessible.length === 0
      ? `<p>${escape(t(l, "statement.nonaccessible.none"))}</p>`
      : `<table>
<caption>${escape(t(l, "statement.nonaccessible.caption"))}</caption>
<thead><tr><th scope="col">${escape(t(l, "statement.nonaccessible.criterion"))}</th><th scope="col">${escape(t(l, "statement.nonaccessible.detail"))}</th><th scope="col">${escape(t(l, "statement.nonaccessible.origin"))}</th></tr></thead>
<tbody>
${view.nonAccessible
  .map(
    (item) =>
      `<tr><th scope="row">${escape(item.criterionId)}</th><td>${escape(item.title)}</td><td class="notes">${escape(
        [item.sources.map(sourceLabel).join(", "), item.notes]
          .filter((part) => part !== "")
          .join("\n"),
      )}</td></tr>`,
  )
  .join("\n")}
</tbody>
</table>`;

  const contact: string[] = [
    `<p>${escape(t(l, "statement.contact.text", { entity }))}</p>`,
  ];
  const contactItems: string[] = [];
  if (view.contactEmail !== null && view.contactEmail !== "") {
    contactItems.push(
      EMAIL.test(view.contactEmail)
        ? `<li>${escape(t(l, "statement.contact.email", { email: "" }).replace(/\s*$/, ""))} <a href="mailto:${escape(view.contactEmail)}">${escape(view.contactEmail)}</a></li>`
        : `<li>${escape(t(l, "statement.contact.email", { email: view.contactEmail }))}</li>`,
    );
  }
  if (view.contactUrl !== null && view.contactUrl !== "") {
    contactItems.push(
      `<li>${escape(t(l, "statement.contact.url"))} ${linkOrText(view.contactUrl)}</li>`,
    );
  }
  if (contactItems.length > 0)
    contact.push(`<ul>${contactItems.join("")}</ul>`);

  const superseded =
    view.supersededBy === null
      ? ""
      : `<p class="notice">${escape(t(l, "statement.superseded"))}${
          view.supersededBy !== "" && isLocalPath(view.supersededBy)
            ? ` <a href="${escape(view.supersededBy)}">${escape(t(l, "statement.superseded.link"))}</a>`
            : ""
        }</p>`;

  const pdf =
    view.pdfPath !== null && isLocalPath(view.pdfPath)
      ? `<p><a href="${escape(view.pdfPath)}">${escape(t(l, "statement.pdf.link"))}</a></p>`
      : "";

  return `<!doctype html>
<html lang="${l}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(t(l, "statement.title"))} – ${escape(entity)}</title>
<meta name="description" content="${escape(t(l, "statement.intro", { site }))}">
<style>${STYLE}</style>
</head>
<body>
<main id="contenu">
<h1>${escape(t(l, "statement.title"))}</h1>
${superseded}
<p>${escape(t(l, "statement.commitment", { entity, site }))}</p>
${pdf}

<h2>${escape(t(l, "statement.compliance.heading"))}</h2>
<p>${escape(t(l, "statement.compliance.level", { site, level: levelText, version: view.referentialVersion }))}</p>

<h2>${escape(t(l, "statement.results.heading"))}</h2>
${results.join("\n")}

<h2>${escape(t(l, "statement.nonaccessible.heading"))}</h2>
${nonAccessible}

<h2>${escape(t(l, "statement.derogations.heading"))}</h2>
<p class="notes-text" style="white-space: pre-wrap">${escape(view.derogations !== null && view.derogations.trim() !== "" ? view.derogations : t(l, "statement.derogations.none"))}</p>

<h2>${escape(t(l, "statement.establishment.heading"))}</h2>
<p>${escape(t(l, "statement.establishment.date", { date: formatDate(view.publishedAt) }))}</p>
<p>${escape(t(l, "statement.establishment.version", { version: view.version }))}</p>

<h2>${escape(t(l, "statement.technologies.heading"))}</h2>
<p>${escape(view.technologies)}</p>

<h2>${escape(t(l, "statement.environment.heading"))}</h2>
<p>${escape(view.testEnvironment)}</p>

<h2>${escape(t(l, "statement.tools.heading"))}</h2>
<p>${escape(view.tools)}</p>

<h2>${escape(t(l, "statement.sample.heading"))}</h2>
<ul>
${view.samplePages.map((page) => `<li>${linkOrText(page)}</li>`).join("\n")}
</ul>

<h2>${escape(t(l, "statement.contact.heading"))}</h2>
${contact.join("\n")}

<h2>${escape(t(l, "statement.recourse.heading"))}</h2>
<p>${escape(t(l, "statement.recourse.text"))}</p>
</main>
<footer>
<p>${escape(t(l, "statement.footer"))}</p>
</footer>
</body>
</html>
`;
}
