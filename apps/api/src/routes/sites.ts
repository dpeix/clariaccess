import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  frequencyIntervalMs,
  planLimits,
  setScheduleRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import { VERIFY_SITE_JOB, type JobQueue } from "@accessibility/queue";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import { sendError } from "../http-errors.js";
import { findOrganizationPlan } from "../orgs/store.js";
import { findUserSite, setSchedule, toSite } from "../sites/store.js";

const idParamsSchema = z.object({ id: z.uuid() });

export interface SiteRoutesDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
}

export function registerSiteRoutes(
  app: FastifyInstance,
  { db, queue, config }: SiteRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });

  const userSite = async (params: unknown, userId: string) => {
    const parsed = idParamsSchema.safeParse(params);
    return parsed.success ? findUserSite(db, userId, parsed.data.id) : null;
  };
  const notFound = (reply: Parameters<typeof sendError>[0]) =>
    sendError(reply, 404, "not_found", "Site introuvable.");

  app.get("/sites/:id", { preHandler }, async (request, reply) => {
    const site = await userSite(request.params, request.user!.id);
    return site === null ? notFound(reply) : toSite(site);
  });

  app.post("/sites/:id/verify", { preHandler }, async (request, reply) => {
    const site = await userSite(request.params, request.user!.id);
    if (site === null) return notFound(reply);
    try {
      const jobId = await queue.enqueue(VERIFY_SITE_JOB, { siteId: site.id });
      if (jobId === null) throw new Error("the queue refused the job");
    } catch (error) {
      request.log.error({ err: error, siteId: site.id }, "enqueue failed");
      return sendError(
        reply,
        503,
        "queue_unavailable",
        "La vérification est momentanément indisponible. Réessayez dans quelques minutes.",
      );
    }
    return reply.status(202).send(toSite(site));
  });

  app.put("/sites/:id/schedule", { preHandler }, async (request, reply) => {
    const site = await userSite(request.params, request.user!.id);
    if (site === null) return notFound(reply);
    const body = setScheduleRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "La fréquence doit être « weekly », « daily » ou null.",
      );
    }
    const { frequency } = body.data;
    // Switching off is always possible, whatever the plan.
    if (frequency !== null) {
      if (site.verifiedAt === null) {
        return sendError(
          reply,
          409,
          "site_not_verified",
          "Prouvez d'abord que vous contrôlez ce site pour programmer des audits.",
        );
      }
      const plan = await findOrganizationPlan(db, site.orgId ?? "");
      if (!planLimits(plan).scheduledFrequencies.includes(frequency)) {
        return sendError(
          reply,
          403,
          "plan_required",
          "Les audits programmés ne sont pas inclus dans votre formule.",
        );
      }
    }
    const updated = await setSchedule(
      db,
      site,
      frequency,
      frequency === null ? 0 : frequencyIntervalMs(frequency),
    );
    return toSite(updated);
  });
}
