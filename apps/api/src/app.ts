import Fastify, { type FastifyError } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Database } from "@accessibility/db";
import type { JobQueue } from "@accessibility/queue";
import { sendError } from "./http-errors.js";
import { registerAuditRoutes } from "./routes/audits.js";
import { registerLeadRoutes } from "./routes/leads.js";

export interface AppConfig {
  ipRateLimit: { max: number; windowSeconds: number };
  domainDailyAuditLimit: number;
  trustProxy: boolean;
}

export interface AppDeps {
  db: Database;
  queue: JobQueue;
  config: AppConfig;
  logger?: boolean;
}

export function buildApp({ db, queue, config, logger = false }: AppDeps) {
  const app = Fastify({ logger, trustProxy: config.trustProxy });

  // Limits are set per route (global: false) so health checks stay unlimited.
  void app.register(rateLimit, { global: false });

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, "not_found", "Ressource introuvable."),
  );
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === "number" && error.statusCode >= 400
        ? error.statusCode
        : 500;
    if (status === 429) {
      return sendError(
        reply,
        429,
        "rate_limited",
        "Trop de requêtes. Réessayez plus tard.",
      );
    }
    if (status < 500) {
      // Client mistakes such as a malformed JSON body.
      return sendError(reply, status, "invalid_request", "Requête invalide.");
    }
    request.log.error({ err: error }, "unhandled error");
    return sendError(reply, 500, "internal_error", "Une erreur est survenue.");
  });

  app.get("/health", () => ({ status: "ok" }));
  // Registered as a plugin so they load after the rate limiter: its per-route
  // settings are picked up when a route is added, not retroactively.
  void app.register(async (scope) => {
    registerAuditRoutes(scope, { db, queue, config });
    registerLeadRoutes(scope, { db, queue, config });
  });

  return app;
}
