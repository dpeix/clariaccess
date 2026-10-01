import { and, count, eq, gt, gte, isNull } from "drizzle-orm";
import { loginTokens, sessions, users, type Database } from "@accessibility/db";
import { hashToken } from "./tokens.js";

export const LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string;
}

export async function countRecentLoginTokens(
  db: Database,
  email: string,
  since: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(loginTokens)
    .where(
      and(eq(loginTokens.email, email), gte(loginTokens.createdAt, since)),
    );
  return row?.total ?? 0;
}

export async function createLoginToken(
  db: Database,
  email: string,
  token: string,
): Promise<void> {
  await db.insert(loginTokens).values({
    tokenHash: hashToken(token),
    email,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_TTL_MS),
  });
}

// One atomic statement: of two concurrent uses of the same link, only one
// gets the row back.
export async function consumeLoginToken(
  db: Database,
  token: string,
): Promise<string | null> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(loginTokens.tokenHash, hashToken(token)),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, new Date()),
      ),
    )
    .returning({ email: loginTokens.email });
  return row?.email ?? null;
}

// Logging in is also signing up: the email is the identity.
export async function findOrCreateUser(
  db: Database,
  email: string,
): Promise<SessionUser> {
  await db.insert(users).values({ email }).onConflictDoNothing();
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email));
  if (user === undefined) throw new Error("User lookup returned no row");
  return user;
}

export async function createSession(
  db: Database,
  userId: string,
  token: string,
): Promise<void> {
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000),
  });
}

export async function findSessionUser(
  db: Database,
  token: string,
): Promise<SessionUser | null> {
  const [row] = await db
    .select({ id: users.id, email: users.email })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

export async function deleteSession(
  db: Database,
  token: string,
): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}
