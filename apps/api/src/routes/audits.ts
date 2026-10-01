import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AUDIT_FAILURE_REASONS,
  freeAuditRequestSchema,
  type AuditFailureReason,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import { RUN_AUDIT_JOB, type JobQueue } from "@accessibility/queue";
import {
  countFreeAuditsForHost,
  createFreeAudit,
  deleteAudit,
  findAudit,
  findAuditAccess,
  findReportIssues,
} from "../audits/store.js";
import type { AppConfig } from "../app.js";
import { optionalUser } from "../auth/guard.js";
import { sendError } from "../http-errors.js";
import { isMember } from "../orgs/store.js";
import { buildReport } from "../report/build-report.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const idParamsSchema = z.object({ id: z.uuid() });

const FAILURE_MESSAGES: Record<AuditFailureReason, string> = {
  forbidden_url:
    "Cette adresse n'est pas accessible publiquement et ne peut pas être auditée.",
  robots_disallowed:
    "Le fichier robots.txt du site interdit l'analyse automatisée.",
  scan_failed:
    "La page n'a pas pu être analysée (indisponible, trop lente ou refusée).",
};

function failureMessage(reason: AuditFailureReason | null): string {
  return reason !== null && AUDIT_FAILURE_REASONS.includes(reason)
    ? FAILURE_MESSAGES[reason]
    : "L'audit a échoué.";
}

export interface AuditRoutesDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
}

export function registerAuditRoutes(
  app: FastifyInstance,
  { db, queue, config }: AuditRoutesDeps,
): void {
  // Results are reached by an unguessable id: keep them out of search engines
  // and shared caches.
  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/audits")) {
      reply.header("X-Robots-Tag", "noindex, nofollow");
      reply.header("Cache-Control", "no-store");
    }
  });

  app.post(
    "/audits/free",
    {
      config: {
        rateLimit: {
          max: config.ipRateLimit.max,
          timeWindow: config.ipRateLimit.windowSeconds * 1000,
        },
      },
    },
    async (request, reply) => {
      const parsed = freeAuditRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          400,
          "invalid_request",
          "L'URL doit être une adresse http(s) valide.",
        );
      }
      const url = new URL(parsed.data.url);
      // Credentials would be stored and logged, and are never needed.
      if (url.username !== "" || url.password !== "") {
        return sendError(
          reply,
          400,
          "invalid_request",
          "L'URL ne doit pas contenir d'identifiants.",
        );
      }
      url.hash = "";

      const recent = await countFreeAuditsForHost(
        db,
        url.host,
        new Date(Date.now() - DAY_MS),
      );
      if (recent >= config.domainDailyAuditLimit) {
        return sendError(
          reply,
          429,
          "rate_limited",
          "Trop d'audits ont déjà été demandés pour ce domaine aujourd'hui. Réessayez demain.",
        );
      }

      const audit = await createFreeAudit(db, url.href);
      try {
        const jobId = await queue.enqueue(RUN_AUDIT_JOB, { auditId: audit.id });
        if (jobId === null) throw new Error("the queue refused the job");
      } catch (error) {
        // Nothing would ever run this audit: do not leave it 'queued'.
        request.log.error({ err: error, auditId: audit.id }, "enqueue failed");
        await deleteAudit(db, audit.id);
        return sendError(
          reply,
          503,
          "queue_unavailable",
          "Le service d'audit est momentanément indisponible. Réessayez dans quelques minutes.",
        );
      }
      return reply.status(202).send(audit);
    },
  );

  // Free audits are read by their link; an organization's audits only by its
  // members, and everyone else gets the same 404 as for an unknown id.
  async function mayRead(request: FastifyRequest, auditId: string) {
    const access = await findAuditAccess(db, auditId);
    if (access === null) return false;
    if (access.orgId === null) return true;
    const user = await optionalUser({ db, config }, request);
    return user !== null && (await isMember(db, user.id, access.orgId));
  }

  app.get("/audits/:id", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const audit =
      params.success && (await mayRead(request, params.data.id))
        ? await findAudit(db, params.data.id)
        : null;
    if (audit === null) {
      return sendError(reply, 404, "not_found", "Audit introuvable.");
    }
    return audit;
  });

  app.get("/audits/:id/report", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const audit =
      params.success && (await mayRead(request, params.data.id))
        ? await findAudit(db, params.data.id)
        : null;
    if (audit === null) {
      return sendError(reply, 404, "not_found", "Audit introuvable.");
    }
    if (audit.status === "failed") {
      return sendError(
        reply,
        409,
        "audit_failed",
        failureMessage(audit.failureReason),
      );
    }
    if (audit.status !== "completed") {
      return sendError(
        reply,
        409,
        "audit_not_completed",
        "L'audit n'est pas encore terminé.",
      );
    }
    return buildReport(audit, await findReportIssues(db, audit.id));
  });
}
