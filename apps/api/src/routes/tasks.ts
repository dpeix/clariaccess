import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  tasksQuerySchema,
  updateTaskRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import type { AppConfig } from "../app.js";
import { createRequireUser } from "../auth/guard.js";
import { sendError } from "../http-errors.js";
import { isMember } from "../orgs/store.js";
import { findUserSite } from "../sites/store.js";
import {
  findUserTask,
  listMembers,
  listTasks,
  updateTask,
} from "../tasks/store.js";

const idParamsSchema = z.object({ id: z.uuid() });
const orgParamsSchema = z.object({ orgId: z.uuid() });
const DEFAULT_LIMIT = 50;

export interface TaskRoutesDeps {
  db: Database;
  config: AppConfig;
}

export function registerTaskRoutes(
  app: FastifyInstance,
  { db, config }: TaskRoutesDeps,
): void {
  const preHandler = createRequireUser({ db, config });

  app.get("/sites/:id/tasks", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const site = params.success
      ? await findUserSite(db, request.user!.id, params.data.id)
      : null;
    if (site === null) {
      return sendError(reply, 404, "not_found", "Site introuvable.");
    }
    const query = tasksQuerySchema.safeParse(request.query);
    if (!query.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Paramètres de recherche invalides.",
      );
    }
    return listTasks(db, site.id, {
      status: query.data.status,
      limit: query.data.limit ?? DEFAULT_LIMIT,
      offset: query.data.offset ?? 0,
    });
  });

  app.patch("/tasks/:id", { preHandler }, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const found = params.success
      ? await findUserTask(db, request.user!.id, params.data.id)
      : null;
    if (found === null) {
      return sendError(reply, 404, "not_found", "Tâche introuvable.");
    }
    const body = updateTaskRequestSchema.safeParse(request.body);
    if (!body.success) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Indiquez un statut valide et/ou une personne à qui assigner la tâche.",
      );
    }
    const { status, assigneeUserId } = body.data;
    // A task goes to someone who can see it.
    if (
      typeof assigneeUserId === "string" &&
      !(await isMember(db, assigneeUserId, found.orgId))
    ) {
      return sendError(
        reply,
        400,
        "invalid_assignee",
        "Cette personne ne fait pas partie de l'organisation.",
      );
    }
    await updateTask(db, found.task.id, { status, assigneeUserId });
    const updated = await findUserTask(db, request.user!.id, found.task.id);
    return (updated ?? found).task;
  });

  app.get("/orgs/:orgId/members", { preHandler }, async (request, reply) => {
    const params = orgParamsSchema.safeParse(request.params);
    if (
      !params.success ||
      !(await isMember(db, request.user!.id, params.data.orgId))
    ) {
      return sendError(reply, 404, "not_found", "Organisation introuvable.");
    }
    return listMembers(db, params.data.orgId);
  });
}
