import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { toPublicView, renderStatementHtml } from "@accessibility/contracts";
import { findPublicStatement, type Database } from "@accessibility/db";
import { RENDER_STATEMENT_PDF_JOB, type JobQueue } from "@accessibility/queue";
import { sendError } from "../http-errors.js";

const slugParamsSchema = z.object({
  slug: z.string().regex(/^[a-z0-9]{12,40}$/),
});

// No script, no font, no image, no framing: the page is text and a style block.
const CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const CACHE = "public, max-age=300";

export interface PublicRoutesDeps {
  db: Database;
  queue: JobQueue;
}

export function registerPublicRoutes(
  app: FastifyInstance,
  { db, queue }: PublicRoutesDeps,
): void {
  // The same answer for every address that is not a public statement: nothing
  // tells a draft, an unknown slug and a malformed one apart.
  const notFound = (reply: Parameters<typeof sendError>[0]) =>
    sendError(reply, 404, "not_found", "Déclaration introuvable.");

  const load = async (slug: unknown) => {
    const params = slugParamsSchema.safeParse({ slug });
    return params.success
      ? findPublicStatement(db, { slug: params.data.slug })
      : null;
  };

  app.get("/d/:slug", async (request, reply) => {
    const found = await load((request.params as { slug?: unknown }).slug);
    if (found === null) return notFound(reply);
    const { row } = found;
    if (
      row.publicSlug === null ||
      row.declaredStatus === null ||
      row.publishedAt === null
    ) {
      return notFound(reply);
    }
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
        pdfReady: row.pdfGeneratedAt !== null,
        currentSlug: found.currentSlug,
      }),
    );
    return reply
      .header("Content-Type", "text/html; charset=utf-8")
      .header("Cache-Control", CACHE)
      .header("Content-Security-Policy", CSP)
      .header("X-Content-Type-Options", "nosniff")
      .send(html);
  });

  app.get("/d/:slug/pdf", async (request, reply) => {
    const found = await load((request.params as { slug?: unknown }).slug);
    if (found === null) return notFound(reply);
    const { row } = found;

    if (row.pdf === null || row.pdfGeneratedAt === null) {
      // The worker has not produced it (yet, or its job was lost): ask again,
      // and tell the reader to come back.
      try {
        await queue.enqueue(RENDER_STATEMENT_PDF_JOB, { statementId: row.id });
      } catch (error) {
        request.log.error(
          { err: error, statementId: row.id },
          "pdf job not queued",
        );
      }
      return sendError(
        reply.header("Retry-After", "30"),
        404,
        "pdf_pending",
        "Le PDF est en cours de génération. Réessayez dans un instant.",
      );
    }
    return reply
      .header("Content-Type", "application/pdf")
      .header(
        "Content-Disposition",
        'inline; filename="declaration-accessibilite.pdf"',
      )
      .header("Cache-Control", CACHE)
      .header("X-Content-Type-Options", "nosniff")
      .send(row.pdf);
  });
}
