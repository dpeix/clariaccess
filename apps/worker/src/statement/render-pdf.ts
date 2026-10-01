import { and, eq, isNull } from "drizzle-orm";
import type { Browser } from "playwright";
import { renderStatementHtml, toPublicView } from "@accessibility/contracts";
import {
  accessibilityStatements,
  findPublicStatement,
  type Database,
} from "@accessibility/db";
import type { Logger } from "../audit/run-audit.js";

export interface RenderStatementDeps {
  db: Database;
  browser: Browser;
  log: Logger;
}

export type RenderOutcome = "rendered" | "skipped";

// Prints an HTML string to an A4 PDF. The page is inert: JavaScript is off and
// every request is refused, so nothing in the content (which includes text
// typed by customers) can run or make the browser fetch anything.
export async function htmlToPdf(
  browser: Browser,
  html: string,
): Promise<Buffer> {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    // setContent loads the string directly: no navigation, so nothing to fetch.
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", bottom: "18mm", left: "16mm", right: "16mm" },
    });
  } finally {
    await context.close();
  }
}

// Renders the PDF of a published (or replaced) statement and stores it. Safe to
// run twice: the update only fills an empty slot, so a redelivered or
// concurrent job never overwrites a PDF. A browser failure is thrown, for the
// queue to retry.
export async function renderStatementPdf(
  deps: RenderStatementDeps,
  statementId: string,
): Promise<RenderOutcome> {
  const { db, log } = deps;
  const found = await findPublicStatement(db, { id: statementId });
  if (found === null) {
    log.info(`statement ${statementId}: not public, nothing to render`);
    return "skipped";
  }
  const { row } = found;
  if (
    row.pdfGeneratedAt !== null ||
    row.publicSlug === null ||
    row.declaredStatus === null ||
    row.publishedAt === null
  ) {
    return "skipped";
  }

  // The PDF does not link to itself.
  const html = renderStatementHtml(
    toPublicView({
      status: row.status === "superseded" ? "superseded" : "published",
      siteUrl: found.siteUrl,
      version: row.version,
      locale: row.locale,
      entityName: row.entityName,
      publishedAt: row.publishedAt,
      declaredStatus: row.declaredStatus,
      referentialVersion: row.referentialVersion,
      complianceRate: row.complianceRate,
      snapshot: row.criteriaSnapshot,
      nonAccessible: row.nonAccessibleContent,
      derogations: row.derogations,
      technologies: row.technologies,
      testEnvironment: row.testEnvironment,
      tools: row.tools,
      samplePages: row.samplePages,
      contactEmail: row.contactEmail,
      contactUrl: row.contactUrl,
      slug: row.publicSlug,
      pdfReady: false,
      currentSlug: found.currentSlug,
    }),
  );
  const pdf = await htmlToPdf(deps.browser, html);

  const stored = await db
    .update(accessibilityStatements)
    .set({ pdf, pdfGeneratedAt: new Date() })
    .where(
      and(
        eq(accessibilityStatements.id, statementId),
        isNull(accessibilityStatements.pdfGeneratedAt),
      ),
    )
    .returning({ id: accessibilityStatements.id });
  if (stored.length === 0) return "skipped";
  log.info(`statement ${statementId}: PDF rendered (${pdf.length} bytes)`);
  return "rendered";
}
