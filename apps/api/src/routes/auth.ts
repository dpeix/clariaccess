import type { FastifyInstance, FastifyReply } from "fastify";
import {
  loginRequestSchema,
  verifyLoginRequestSchema,
} from "@accessibility/contracts";
import type { Database } from "@accessibility/db";
import type { AppConfig } from "../app.js";
import { SESSION_COOKIE, createRequireUser } from "../auth/guard.js";
import {
  SESSION_TTL_SECONDS,
  consumeLoginToken,
  countRecentLoginTokens,
  createLoginToken,
  createSession,
  deleteSession,
  findOrCreateUser,
} from "../auth/store.js";
import { generateToken } from "../auth/tokens.js";
import { sendError } from "../http-errors.js";
import { renderLoginEmail } from "../mail/login-email.js";
import type { Mailer } from "../mail/mailer.js";
import { listOrganizations } from "../orgs/store.js";

const HOUR_MS = 60 * 60 * 1000;

export interface AuthRoutesDeps {
  db: Database;
  mailer: Mailer;
  config: AppConfig;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  { db, mailer, config }: AuthRoutesDeps,
): void {
  const requireUser = createRequireUser({ db, config });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
  } as const;

  // Credentials are only ever sent by the customer app.
  const refuseForeignOrigin = (
    origin: string | undefined,
    reply: FastifyReply,
  ) =>
    origin !== undefined && origin !== config.appOrigin
      ? sendError(reply, 403, "forbidden_origin", "Origine non autorisée.")
      : undefined;

  app.post(
    "/auth/login",
    {
      config: {
        rateLimit: {
          max: config.loginRateLimit.max,
          timeWindow: config.loginRateLimit.windowSeconds * 1000,
        },
      },
    },
    async (request, reply) => {
      const parsed = loginRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(
          reply,
          400,
          "invalid_request",
          "Indiquez une adresse email valide.",
        );
      }
      const email = parsed.data.email.trim().toLowerCase();

      // Whatever happens below the answer is the same: the endpoint must not
      // tell whether a mail went out. Logging in also creates accounts, so
      // every address is treated alike.
      const recent = await countRecentLoginTokens(
        db,
        email,
        new Date(Date.now() - HOUR_MS),
      );
      if (recent < config.loginEmailsPerAddressPerHour) {
        const token = generateToken();
        await createLoginToken(db, email, token);
        const link = new URL("/auth/callback", config.appOrigin);
        link.searchParams.set("token", token);
        try {
          await mailer.send({ to: email, ...renderLoginEmail(link.href) });
        } catch (error) {
          // Not logged with the address: it is personal data.
          request.log.error({ err: error }, "login email could not be sent");
        }
      }
      return reply.status(202).send();
    },
  );

  app.post("/auth/verify", async (request, reply) => {
    const refused = refuseForeignOrigin(request.headers.origin, reply);
    if (refused !== undefined) return refused;
    const parsed = verifyLoginRequestSchema.safeParse(request.body);
    const email = parsed.success
      ? await consumeLoginToken(db, parsed.data.token)
      : null;
    if (email === null) {
      return sendError(
        reply,
        400,
        "invalid_token",
        "Ce lien est invalide ou a expiré. Demandez-en un nouveau.",
      );
    }
    const user = await findOrCreateUser(db, email);
    const sessionToken = generateToken();
    await createSession(db, user.id, sessionToken);
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...cookieOptions,
      maxAge: SESSION_TTL_SECONDS,
    });
    return { user, organizations: await listOrganizations(db, user.id) };
  });

  app.get("/me", { preHandler: requireUser }, async (request) => {
    const user = request.user!;
    return { user, organizations: await listOrganizations(db, user.id) };
  });

  app.post(
    "/auth/logout",
    { preHandler: requireUser },
    async (request, reply) => {
      await deleteSession(db, request.cookies[SESSION_COOKIE] ?? "");
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return reply.status(204).send();
    },
  );
}
