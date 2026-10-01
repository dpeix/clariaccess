import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  findingsQuerySchema,
  updateFindingRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import {
  changeFindingStatus,
  findUserFinding,
  listFindings,
} from "../findings/store.js";
import { sendError } from "../http-errors.js";
import { findUserSite } from "../sites/store.js";

const idParamsSchema = z.object({ id: z.uuid() });
const DEFAULT_LIMIT = 50;

export interface FindingRoutesDeps {
  db: Database;
  config: AppConfig;
}

export function registerFindingRoutes(
  app: FastifyInstance,
  { db, config }: FindingRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });

  app.get("/sites/:id/findings", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const site = params.success
      ? await findUserSite(db, request.user!.id, params.data.id)
      : null;
    if (site === null) {
      return sendError(reply, 404, "not_found", "Site introuvable.");
    }
    const query = findingsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Paramètres de recherche invalides.",
      );
    }
    return listFindings(db, site.id, {
      status: query.data.status,
      limit: query.data.limit ?? DEFAULT_LIMIT,
      offset: query.data.offset ?? 0,
    });
  });

  app.patch("/findings/:id", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const finding = params.success
      ? await findUserFinding(db, request.user!.id, params.data.id)
      : null;
    if (finding === null) {
      return sendError(reply, 404, "not_found", "Constat introuvable.");
    }
    const body = updateFindingRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Le statut doit être « open » ou « ignored ».",
      );
    }
    const target = body.data.status;
    if (finding.status === target) return finding;

    // A user ignores a live problem or reopens an ignored one. Whether a
    // problem is fixed or has regressed is what audits find out.
    const allowed =
      target === "ignored"
        ? finding.status === "open" || finding.status === "regressed"
        : finding.status === "ignored";
    if (
      !allowed ||
      !(await changeFindingStatus(db, finding.id, finding.status, target))
    ) {
      return sendError(
        reply,
        409,
        "invalid_transition",
        "Ce constat ne peut pas passer à ce statut.",
      );
    }
    return (await findUserFinding(db, request.user!.id, finding.id)) ?? finding;
  });
}
