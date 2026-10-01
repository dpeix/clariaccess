import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  REQUIRED_STATEMENT_FIELDS,
  publishStatementRequestSchema,
  updateStatementRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import { RENDER_STATEMENT_PDF_JOB, type JobQueue } from "@accessibility/queue";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import { sendError } from "../http-errors.js";
import { findUserSite } from "../sites/store.js";
import {
  computeLive,
  createDraft,
  findUserStatement,
  listStatements,
  publishDraft,
  toStatement,
  updateDraft,
  type StatementRow,
} from "../statements/store.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface StatementRoutesDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
}

export function registerStatementRoutes(
  app: FastifyInstance,
  { db, queue, config }: StatementRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });
  const notFound = (reply: Parameters<typeof sendError>[0]) =>
    sendError(reply, 404, "not_found", "Introuvable.");

  // A draft is shown with the live audit; other versions as they were frozen.
  const view = async (row: StatementRow) =>
    toStatement(
      row,
      row.status === "draft" ? await computeLive(db, row.siteId) : null,
    );

  app.post("/sites/:id/statements", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const site = params.success
      ? await findUserSite(db, request.user!.id, params.data.id)
      : null;
    if (site === null || site.orgId === null) return notFound(reply);

    const created = await createDraft(db, {
      id: site.id,
      baseUrl: site.baseUrl,
      orgId: site.orgId,
    });
    if (created.kind === "draft_exists") {
      return sendError(
        reply,
        409,
        "draft_exists",
        "Une déclaration est déjà en cours de rédaction pour ce site.",
      );
    }
    return reply.status(201).send(await view(created.row));
  });

  app.get("/sites/:id/statements", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const site = params.success
      ? await findUserSite(db, request.user!.id, params.data.id)
      : null;
    if (site === null) return notFound(reply);
    const rows = await listStatements(db, site.id);
    return Promise.all(rows.map(view));
  });

  app.get("/statements/:id", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const found = params.success
      ? await findUserStatement(db, request.user!.id, params.data.id)
      : null;
    if (found === null) return notFound(reply);
    return view(found.row);
  });

  app.put("/statements/:id", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const found = params.success
      ? await findUserStatement(db, request.user!.id, params.data.id)
      : null;
    if (found === null) return notFound(reply);
    const body = updateStatementRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Certains champs de la déclaration sont invalides.",
      );
    }
    const updated = await updateDraft(db, found.row.id, body.data);
    if (updated === null) {
      return sendError(
        reply,
        409,
        "not_a_draft",
        "Cette déclaration est publiée : créez une nouvelle version pour la modifier.",
      );
    }
    return view(updated);
  });

  const FIELD_LABELS: Record<
    (typeof REQUIRED_STATEMENT_FIELDS)[number],
    string
  > = {
    entityName: "nom de l'éditeur",
    contact: "contact (courriel ou page)",
    samplePages: "pages vérifiées",
    technologies: "technologies utilisées",
    testEnvironment: "environnement de test",
    tools: "outils d'évaluation",
  };

  app.post(
    "/statements/:id/publish",
    { preHandler },
    async (request, reply) => {
      const params = idParamsSchema.safeParse(request.params);
      const found = params.success
        ? await findUserStatement(db, request.user!.id, params.data.id)
        : null;
      if (found === null) return notFound(reply);
      // A published statement engages the organization: only an owner decides.
      if (found.role !== "owner") {
        return sendError(
          reply,
          403,
          "owner_required",
          "Seul un propriétaire de l'organisation peut publier une déclaration.",
        );
      }
      const body = publishStatementRequestSchema.safeParse(request.body);
      if (!body.success) {
        return sendError(
          reply,
          400,
          "invalid_request",
          "Indiquez le niveau déclaré : total, partiel ou non.",
        );
      }

      const result = await publishDraft(
        db,
        found.row.id,
        request.user!.id,
        body.data.declaredStatus,
      );
      switch (result.kind) {
        case "not_a_draft":
          return sendError(
            reply,
            409,
            "not_a_draft",
            "Cette déclaration n'est plus un brouillon.",
          );
        case "incomplete":
          return sendError(
            reply,
            400,
            "incomplete",
            `Déclaration incomplète. Il manque : ${result.missing
              .map(
                (field) =>
                  FIELD_LABELS[field as keyof typeof FIELD_LABELS] ?? field,
              )
              .join(", ")}.`,
          );
        case "audit_incomplete":
          return sendError(
            reply,
            400,
            "audit_incomplete",
            "L'audit n'est pas terminé : vérifiez tous les critères applicables avant de publier.",
          );
        case "status_not_supported":
          return sendError(
            reply,
            400,
            "status_not_supported",
            "Ce niveau est plus favorable que ce que l'audit permet d'affirmer.",
          );
        case "published":
          break;
      }

      // After the commit: the page is already public, the PDF follows. A queue
      // outage is not a reason to undo a publication; the PDF is asked again when
      // someone requests it.
      try {
        const jobId = await queue.enqueue(RENDER_STATEMENT_PDF_JOB, {
          statementId: result.row.id,
        });
        if (jobId === null) throw new Error("the queue refused the job");
      } catch (error) {
        request.log.error(
          { err: error, statementId: result.row.id },
          "pdf job not queued",
        );
      }
      return view(result.row);
    },
  );
}
