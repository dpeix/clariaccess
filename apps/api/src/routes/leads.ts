import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { leadRequestSchema } from "@accessibility/contracts";
import { leads, type Database } from "@accessibility/db";
import { SEND_REPORT_JOB, type JobQueue } from "@accessibility/queue";
import { findAudit } from "../audits/store.js";
import type { AppConfig } from "../app.js";
import { sendError } from "../http-errors.js";

export interface LeadRoutesDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
}

export function registerLeadRoutes(
  app: FastifyInstance,
  { db, queue, config }: LeadRoutesDeps,
): void {
  app.post(
    "/leads",
    {
      config: {
        rateLimit: {
          max: config.ipRateLimit.max,
          timeWindow: config.ipRateLimit.windowSeconds * 1000,
        },
      },
    },
    async (request, reply) => {
      const parsed = leadRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          400,
          "invalid_request",
          "Adresse email, audit et consentement explicite sont requis.",
        );
      }
      const { auditId, source, utm } = parsed.data;
      // Addresses differ only by case in practice; one lead per person.
      const email = parsed.data.email.toLowerCase();

      const audit = await findAudit(db, auditId);
      if (audit === null) {
        return sendError(reply, 404, "not_found", "Audit introuvable.");
      }

      const [inserted] = await db
        .insert(leads)
        .values({
          email,
          url: audit.url,
          auditId,
          consent: true,
          source: source ?? null,
          utm: utm ?? null,
        })
        .onConflictDoNothing({ target: [leads.email, leads.auditId] })
        .returning({ id: leads.id });

      let leadId = inserted?.id;
      if (leadId === undefined) {
        // Already known: answer the same, and only queue the email again if it
        // never went out (e.g. the queue was down on the first attempt).
        const [existing] = await db
          .select({ id: leads.id, reportSentAt: leads.reportSentAt })
          .from(leads)
          .where(and(eq(leads.email, email), eq(leads.auditId, auditId)));
        if (existing === undefined || existing.reportSentAt !== null) {
          return reply.status(201).send();
        }
        leadId = existing.id;
      }

      try {
        const jobId = await queue.enqueue(SEND_REPORT_JOB, { leadId });
        if (jobId === null) throw new Error("the queue refused the job");
      } catch (error) {
        request.log.error({ err: error, leadId }, "enqueue failed");
        return sendError(
          reply,
          503,
          "queue_unavailable",
          "L'envoi du rapport est momentanément indisponible. Réessayez dans quelques minutes.",
        );
      }
      return reply.status(201).send();
    },
  );
}
