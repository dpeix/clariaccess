import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  upsertManualCheckRequestSchema,
  type ManualCheckList,
} from "@accessibility/contracts";
import { manualChecks, type Database } from "@accessibility/db";
import {
  RGAA_CRITERIA,
  RGAA_THEMES,
  RGAA_VERSION,
  autoCoverage,
  criterionById,
  lookupAxeRule,
} from "@accessibility/rules";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import { loadAutoFindings, loadManualChecks } from "../compliance/inputs.js";
import { sendError } from "../http-errors.js";
import { findUserSite } from "../sites/store.js";

const siteParamsSchema = z.object({ id: z.uuid() });
// Not a regexp-validated criterion yet: the reference decides what exists.
const criterionParamsSchema = z.object({
  id: z.uuid(),
  criterionId: z.string().max(10),
});

export interface ManualCheckRoutesDeps {
  db: Database;
  config: AppConfig;
}

export function registerManualCheckRoutes(
  app: FastifyInstance,
  { db, config }: ManualCheckRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });
  const notFound = (reply: Parameters<typeof sendError>[0]) =>
    sendError(reply, 404, "not_found", "Site ou critère introuvable.");

  app.get(
    "/sites/:id/manual-checks",
    { preHandler },
    async (request, reply) => {
      const params = siteParamsSchema.safeParse(request.params);
      const site = params.success
        ? await findUserSite(db, request.user!.id, params.data.id)
        : null;
      if (site === null) return notFound(reply);

      const [checks, autoFindings] = await Promise.all([
        loadManualChecks(db, site.id),
        loadAutoFindings(db, site.id),
      ]);
      const byCriterion = new Map(checks.map((c) => [c.criterionId, c]));
      // Problems the scan reports, counted per criterion through the rule mapping.
      const problems = new Map<string, number>();
      for (const finding of autoFindings) {
        const lookup = lookupAxeRule(finding.ruleId);
        if (lookup.status !== "mapped") continue;
        for (const id of lookup.rgaaCriteria) {
          problems.set(id, (problems.get(id) ?? 0) + 1);
        }
      }

      const body: ManualCheckList = {
        referentialVersion: RGAA_VERSION,
        themes: RGAA_THEMES.map((t) => ({ number: t.number, title: t.title })),
        criteria: RGAA_CRITERIA.map((criterion) => {
          const check = byCriterion.get(criterion.id);
          const coverage = autoCoverage(criterion.id);
          return {
            id: criterion.id,
            theme: criterion.theme,
            title: criterion.title,
            autoTested: coverage.tested,
            axeRules: coverage.axeRules,
            autoProblems: problems.get(criterion.id) ?? 0,
            check:
              check === undefined
                ? null
                : {
                    status: check.status,
                    notes: check.notes,
                    evidenceUrl: check.evidenceUrl,
                    checkedBy: check.checkedByEmail,
                    checkedAt: check.checkedAt.toISOString(),
                  },
          };
        }),
        progress: {
          checked: checks.filter(
            (c) => criterionById(c.criterionId) !== undefined,
          ).length,
          total: RGAA_CRITERIA.length,
        },
      };
      return body;
    },
  );

  app.put(
    "/sites/:id/manual-checks/:criterionId",
    { preHandler },
    async (request, reply) => {
      const params = criterionParamsSchema.safeParse(request.params);
      const site = params.success
        ? await findUserSite(db, request.user!.id, params.data.id)
        : null;
      if (
        !params.success ||
        site === null ||
        criterionById(params.data.criterionId) === undefined
      ) {
        return notFound(reply);
      }
      const body = upsertManualCheckRequestSchema.safeParse(request.body);
      if (!body.success) {
        return sendError(
          reply,
          400,
          "invalid_request",
          "Indiquez un statut (ok, ko ou na), des notes de 5000 caractères au plus et un lien de preuve http(s).",
        );
      }
      const values = {
        siteId: site.id,
        criterionId: params.data.criterionId,
        status: body.data.status,
        notes: body.data.notes ?? "",
        evidenceUrl: body.data.evidenceUrl ?? null,
        checkedBy: request.user!.id,
      };
      await db
        .insert(manualChecks)
        .values(values)
        .onConflictDoUpdate({
          target: [manualChecks.siteId, manualChecks.criterionId],
          set: {
            status: values.status,
            notes: values.notes,
            evidenceUrl: values.evidenceUrl,
            checkedBy: values.checkedBy,
            checkedAt: sql`now()`,
          },
        });
      return reply.status(204).send();
    },
  );

  app.delete(
    "/sites/:id/manual-checks/:criterionId",
    { preHandler },
    async (request, reply) => {
      const params = criterionParamsSchema.safeParse(request.params);
      const site = params.success
        ? await findUserSite(db, request.user!.id, params.data.id)
        : null;
      if (
        !params.success ||
        site === null ||
        criterionById(params.data.criterionId) === undefined
      ) {
        return notFound(reply);
      }
      await db
        .delete(manualChecks)
        .where(
          and(
            eq(manualChecks.siteId, site.id),
            eq(manualChecks.criterionId, params.data.criterionId),
          ),
        );
      return reply.status(204).send();
    },
  );
}
