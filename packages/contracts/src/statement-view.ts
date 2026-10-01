import { DEFAULT_LOCALE, isLocale } from "./i18n.js";
import type { PublicStatementView } from "./statement-html.js";

// What the public page needs from a stored statement. Plain values, so the API
// and the worker can both build it from their own query.
export interface PublishedStatementInput {
  status: "published" | "superseded";
  siteUrl: string;
  version: number;
  locale: string;
  entityName: string | null;
  publishedAt: Date;
  declaredStatus: "total" | "partiel" | "non";
  referentialVersion: string;
  complianceRate: number | null;
  // jsonb as stored: not trusted.
  snapshot: unknown;
  nonAccessible: unknown;
  derogations: string | null;
  technologies: string | null;
  testEnvironment: string | null;
  tools: string | null;
  samplePages: unknown;
  contactEmail: string | null;
  contactUrl: string | null;
  slug: string;
  pdfReady: boolean;
  // Slug of the statement currently in force for the site, when this one was replaced.
  currentSlug: string | null;
}

const ZERO_COUNTS = { conforme: 0, nonConforme: 0, na: 0, aVerifier: 0 };

function counts(snapshot: unknown): PublicStatementView["counts"] {
  const value = (snapshot as { counts?: Record<string, unknown> } | null)
    ?.counts;
  const n = (key: string) =>
    typeof value?.[key] === "number" ? (value[key] as number) : 0;
  return value === undefined
    ? ZERO_COUNTS
    : {
        conforme: n("conforme"),
        nonConforme: n("nonConforme"),
        na: n("na"),
        aVerifier: n("aVerifier"),
      };
}

function nonAccessible(value: unknown): PublicStatementView["nonAccessible"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const o = item as Record<string, unknown> | null;
    if (
      typeof o?.["criterionId"] !== "string" ||
      typeof o["title"] !== "string"
    )
      return [];
    const sources = Array.isArray(o["sources"])
      ? o["sources"].filter(
          (s): s is "manual" | "auto" => s === "manual" || s === "auto",
        )
      : [];
    return [
      {
        criterionId: o["criterionId"],
        title: o["title"],
        sources,
        notes: typeof o["notes"] === "string" ? o["notes"] : "",
      },
    ];
  });
}

export function toPublicView(
  input: PublishedStatementInput,
): PublicStatementView {
  return {
    locale: isLocale(input.locale) ? input.locale : DEFAULT_LOCALE,
    siteUrl: input.siteUrl,
    entityName: input.entityName ?? "",
    version: input.version,
    publishedAt: input.publishedAt.toISOString(),
    declaredStatus: input.declaredStatus,
    rate: input.complianceRate,
    referentialVersion: input.referentialVersion,
    counts: counts(input.snapshot),
    nonAccessible: nonAccessible(input.nonAccessible),
    derogations: input.derogations,
    technologies: input.technologies ?? "",
    testEnvironment: input.testEnvironment ?? "",
    tools: input.tools ?? "",
    samplePages: Array.isArray(input.samplePages)
      ? input.samplePages.filter((p): p is string => typeof p === "string")
      : [],
    contactEmail: input.contactEmail,
    contactUrl: input.contactUrl,
    pdfPath: input.pdfReady ? `/d/${input.slug}/pdf` : null,
    supersededBy:
      input.status === "superseded"
        ? input.currentSlug === null
          ? ""
          : `/d/${input.currentSlug}`
        : null,
  };
}
