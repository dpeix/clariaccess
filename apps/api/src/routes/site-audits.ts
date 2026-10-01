import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "@accessibility/db";
import { SCAN_PAGE_JOB, type JobQueue } from "@accessibility/queue";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import {
  deleteAudit,
  findAuditAccess,
  listAuditPages,
  listSiteAudits,
  startSiteAudit,
} from "../audits/store.js";
import { planLimits } from "@accessibility/contracts";
import { sendError } from "../http-errors.js";
import { findOrganizationPlan, isMember } from "../orgs/store.js";
import { findUserSite } from "../sites/store.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface SiteAuditRoutesDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
}

export function registerSiteAuditRoutes(
  app: FastifyInstance,
  { db, queue, config }: SiteAuditRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });

  const userSite = async (params: unknown, userId: string) => {
    const parsed = idParamsSchema.safeParse(params);
    return parsed.success ? findUserSite(db, userId, parsed.data.id) : null;
  };

  app.post("/sites/:id/audits", { preHandler }, async (request, reply) => {
    const site = await userSite(request.params, request.user!.id);
    if (site === null) {
      return sendError(reply, 404, "not_found", "Site introuvable.");
    }
    if (site.verifiedAt === null) {
      return sendError(
        reply,
        409,
        "site_not_verified",
        "Prouvez d'abord que vous contrôlez ce site avant de lancer un audit.",
      );
    }

    // The plan's quota, never above the technical cap of the deployment.
    const plan = await findOrganizationPlan(db, site.orgId ?? "");
    const dailyLimit = Math.min(
      config.siteDailyAuditLimit,
      planLimits(plan).manualAuditsPerDayPerSite,
    );
    const started = await startSiteAudit(db, site, dailyLimit);
    if (started.kind === "in_progress") {
      return sendError(
        reply,
        409,
        "audit_in_progress",
        "Un audit est déjà en cours pour ce site.",
      );
    }
    if (started.kind === "limit") {
      return sendError(
        reply,
        429,
        "rate_limited",
        "Limite quotidienne d'audits atteinte pour ce site. Réessayez demain.",
      );
    }

    try {
      const jobId = await queue.enqueue(SCAN_PAGE_JOB, {
        auditId: started.audit.id,
        pageId: started.pageId,
      });
      if (jobId === null) throw new Error("the queue refused the job");
    } catch (error) {
      // Nothing would ever run this audit: do not leave it blocking the site.
      request.log.error(
        { err: error, auditId: started.audit.id },
        "enqueue failed",
      );
      await deleteAudit(db, started.audit.id);
      return sendError(
        reply,
        503,
        "queue_unavailable",
        "Le service d'audit est momentanément indisponible. Réessayez dans quelques minutes.",
      );
    }
    return reply.status(202).send(started.audit);
  });

  app.get("/sites/:id/audits", { preHandler }, async (request, reply) => {
    const site = await userSite(request.params, request.user!.id);
    if (site === null) {
      return sendError(reply, 404, "not_found", "Site introuvable.");
    }
    return listSiteAudits(db, site);
  });

  app.get("/audits/:id/pages", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const access = params.success
      ? await findAuditAccess(db, params.data.id)
      : null;
    if (
      !params.success ||
      access === null ||
      access.orgId === null ||
      !(await isMember(db, request.user!.id, access.orgId))
    ) {
      return sendError(reply, 404, "not_found", "Audit introuvable.");
    }
    return listAuditPages(db, params.data.id);
  });
}
