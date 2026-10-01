import type { FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "@accessibility/db";
import type { AppConfig } from "../app.js";
import { sendError } from "../http-errors.js";
import { findSessionUser, type SessionUser } from "./store.js";

export const SESSION_COOKIE = "session";

declare module "fastify" {
  interface FastifyRequest {
    // Set by requireUser on authenticated routes.
    user?: SessionUser;
  }
}

export interface AuthGuardDeps {
  db: Database;
  config: AppConfig;
}

// Rejects requests without a valid session. A browser request from any origin
// other than the customer app is refused outright, even with a valid cookie:
// that is what stops another site (including our public one) from riding on a
// customer's session. Requests without Origin (curl, server-side) carry no
// ambient cookie, so they only work with a cookie the caller already has.
export function createRequireUser({ db, config }: AuthGuardDeps) {
  return async function requireUser(
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== config.appOrigin) {
      return sendError(
        reply,
        403,
        "forbidden_origin",
        "Origine non autorisée.",
      );
    }
    const token = request.cookies[SESSION_COOKIE];
    const user =
      token === undefined || token === ""
        ? null
        : await findSessionUser(db, token);
    if (user === null) {
      return sendError(reply, 401, "unauthorized", "Connexion requise.");
    }
    request.user = user;
  };
}

// The signed-in user, or null: no session, or a request from another origin
// (see requireUser). For routes that are public for some resources and private
// for others, where a refusal must look like "not found".
export async function optionalUser(
  { db, config }: AuthGuardDeps,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  const origin = request.headers.origin;
  if (origin !== undefined && origin !== config.appOrigin) return null;
  const token = request.cookies[SESSION_COOKIE];
  return token === undefined || token === ""
    ? null
    : findSessionUser(db, token);
}
