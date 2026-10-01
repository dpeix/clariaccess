import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { Database } from "@accessibility/db";
import type { JobQueue } from "@accessibility/queue";
import { sendError } from "./http-errors.js";
import type { Mailer } from "./mail/mailer.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAuditRoutes } from "./routes/audits.js";
import { registerFindingRoutes } from "./routes/findings.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerManualCheckRoutes } from "./routes/manual-checks.js";
import { registerOrgRoutes } from "./routes/orgs.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerStatementRoutes } from "./routes/statements.js";
import { registerSiteAuditRoutes } from "./routes/site-audits.js";
import { registerSiteRoutes } from "./routes/sites.js";

export interface AppConfig {
  ipRateLimit: { max: number; windowSeconds: number };
  domainDailyAuditLimit: number;
  trustProxy: boolean;
  // Origin (no path) of the public site, the only browser origin allowed to
  // call the API.
  corsOrigin: string;
  // Origin of the customer app: login link target, and the only browser origin
  // allowed to make signed-in (cookie) requests.
  appOrigin: string;
  secureCookies: boolean;
  loginRateLimit: { max: number; windowSeconds: number };
  loginEmailsPerAddressPerHour: number;
  // Multi-page audits a site may start per 24 hours.
  siteDailyAuditLimit: number;
}

export interface AppDeps {
  db: Database;
  queue: JobQueue;
  mailer: Mailer;
  config: AppConfig;
  logger?: boolean;
}

export function buildApp({
  db,
  queue,
  mailer,
  config,
  logger = false,
}: AppDeps) {
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    // Above the default 100 so a too-long public slug is rejected by the route
    // (a plain 404, like any unknown slug) rather than by the router.
    maxParamLength: 500,
  });

  void app.register(cors, {
    // An array reflects the origin only on an exact match.
    origin: [config.corsOrigin, config.appOrigin],
    methods: ["GET", "POST", "PATCH"],
    // Cookies are only honoured for the app origin (see requireUser); the
    // public site never sends credentials.
    credentials: true,
  });
  void app.register(cookie);

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
    registerAuthRoutes(scope, { db, mailer, config });
    registerAuditRoutes(scope, { db, queue, config });
    registerLeadRoutes(scope, { db, queue, config });
    registerOrgRoutes(scope, { db, config });
    registerFindingRoutes(scope, { db, config });
    registerTaskRoutes(scope, { db, config });
    registerManualCheckRoutes(scope, { db, config });
    registerStatementRoutes(scope, { db, queue, config });
    registerPublicRoutes(scope, { db, queue });
    registerSiteRoutes(scope, { db, queue, config });
    registerSiteAuditRoutes(scope, { db, queue, config });
  });

  return app;
}
