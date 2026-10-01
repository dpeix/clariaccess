import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createOrganizationRequestSchema,
  createSiteRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import { generateToken } from "../auth/tokens.js";
import { sendError } from "../http-errors.js";
import {
  createOrganization,
  isMember,
  listOrganizations,
} from "../orgs/store.js";
import { createSite, listSites, toSite } from "../sites/store.js";

const orgParamsSchema = z.object({ orgId: z.uuid() });

export interface OrgRoutesDeps {
  db: Database;
  config: AppConfig;
}

export function registerOrgRoutes(
  app: FastifyInstance,
  { db, config }: OrgRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });

  app.post("/orgs", { preHandler }, async (request, reply) => {
    const parsed = createOrganizationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Indiquez un nom d'organisation (100 caractères maximum).",
      );
    }
    const org = await createOrganization(
      db,
      request.user!.id,
      parsed.data.name,
    );
    return reply.status(201).send(org);
  });

  app.get("/orgs", { preHandler }, async (request) =>
    listOrganizations(db, request.user!.id),
  );

  // A non-member gets the same 404 as an unknown id.
  const memberOrgId = async (
    params: unknown,
    userId: string,
  ): Promise<string | null> => {
    const parsed = orgParamsSchema.safeParse(params);
    if (!parsed.success) return null;
    return (await isMember(db, userId, parsed.data.orgId))
      ? parsed.data.orgId
      : null;
  };

  app.post("/orgs/:orgId/sites", { preHandler }, async (request, reply) => {
    const orgId = await memberOrgId(request.params, request.user!.id);
    if (orgId === null) {
      return sendError(reply, 404, "not_found", "Organisation introuvable.");
    }
    const parsed = createSiteRequestSchema.safeParse(request.body);
    const url = parsed.success ? new URL(parsed.data.baseUrl) : null;
    if (url === null || url.username !== "" || url.password !== "") {
      return sendError(
        reply,
        400,
        "invalid_request",
        "L'adresse doit être une URL http(s) sans identifiants.",
      );
    }
    // The site is its origin: the scope of its crawl and of its ownership proof.
    const created = await createSite(db, orgId, url.origin, generateToken());
    if (created.kind === "plan_limit") {
      return sendError(
        reply,
        403,
        "plan_limit",
        "Votre formule ne permet pas d'ajouter d'autre site.",
      );
    }
    if (created.kind === "duplicate") {
      return sendError(
        reply,
        409,
        "already_exists",
        "Ce site est déjà dans votre organisation.",
      );
    }
    return reply.status(201).send(toSite(created.site));
  });

  app.get("/orgs/:orgId/sites", { preHandler }, async (request, reply) => {
    const orgId = await memberOrgId(request.params, request.user!.id);
    if (orgId === null) {
      return sendError(reply, 404, "not_found", "Organisation introuvable.");
    }
    return (await listSites(db, orgId)).map(toSite);
  });
}
