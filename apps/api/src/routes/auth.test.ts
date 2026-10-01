import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginTokens, sessions, users } from "@accessibility/db";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, signIn, type Harness } from "../test/harness.js";
import { hashToken } from "../auth/tokens.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("auth routes", () => {
  let h: Harness & { test: unknown };

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });
  beforeEach(() => {
    h.mailer.sent.length = 0;
  });

  const login = (email: string) =>
    h.app.inject({ method: "POST", url: "/auth/login", payload: { email } });
  const tokenFromMail = (index = h.mailer.sent.length - 1) =>
    /token=([A-Za-z0-9_-]+)/.exec(h.mailer.sent[index]?.text ?? "")?.[1] ?? "";
  const verify = (token: string) =>
    h.app.inject({ method: "POST", url: "/auth/verify", payload: { token } });

  describe("POST /auth/login", () => {
    it("answers 202 and emails a link to the app", async () => {
      const response = await login("Visiteur@Example.fr");

      expect(response.statusCode).toBe(202);
      expect(h.mailer.sent).toHaveLength(1);
      const mail = h.mailer.sent[0]!;
      expect(mail.to).toBe("visiteur@example.fr");
      expect(mail.subject).toBe("Votre lien de connexion");
      expect(mail.text).toContain(
        "https://app.example.fr/auth/callback?token=",
      );
    });

    it("stores only a hash of the token", async () => {
      await login("hash@example.fr");
      const token = tokenFromMail();

      const rows = await h.db
        .select()
        .from(loginTokens)
        .where(eq(loginTokens.email, "hash@example.fr"));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(hashToken(token));
      expect(JSON.stringify(rows)).not.toContain(token);
    });

    it("rejects an invalid email without sending anything", async () => {
      const response = await login("not-an-email");

      expect(response.statusCode).toBe(400);
      expect(h.mailer.sent).toHaveLength(0);
    });

    it("answers the same whether or not the address is already a user", async () => {
      await signIn(h, "known@example.fr");
      h.mailer.sent.length = 0;

      const known = await login("known@example.fr");
      const unknown = await login("unknown@example.fr");

      expect(known.statusCode).toBe(unknown.statusCode);
      expect(known.body).toBe(unknown.body);
      expect(h.mailer.sent).toHaveLength(2);
    });

    it("stops emailing an address that asks too often, still answering 202", async () => {
      for (let i = 0; i < 5; i += 1) await login("flood@example.fr");
      expect(h.mailer.sent).toHaveLength(5);

      const response = await login("flood@example.fr");

      expect(response.statusCode).toBe(202);
      expect(h.mailer.sent).toHaveLength(5);
    });

    it("still answers 202 when the mail cannot be sent", async () => {
      h.mailer.fail = true;
      try {
        const response = await login("smtp-down@example.fr");
        expect(response.statusCode).toBe(202);
      } finally {
        h.mailer.fail = false;
      }
    });
  });

  describe("POST /auth/verify", () => {
    it("signs in, creating the user, with a hardened cookie", async () => {
      await login("new@example.fr");

      const response = await verify(tokenFromMail());

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        user: { email: "new@example.fr" },
        organizations: [],
      });
      const cookie = response.cookies.find((c) => c.name === "session");
      expect(cookie).toMatchObject({
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
      });
      expect(cookie?.maxAge).toBeGreaterThan(0);
      const [user] = await h.db
        .select()
        .from(users)
        .where(eq(users.email, "new@example.fr"));
      expect(user).toBeDefined();
    });

    it("stores only a hash of the session token", async () => {
      await login("session-hash@example.fr");
      const response = await verify(tokenFromMail());
      const value = response.cookies.find((c) => c.name === "session")!.value;

      const [row] = await h.db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hashToken(value)));
      expect(row).toBeDefined();
      expect(JSON.stringify(await h.db.select().from(sessions))).not.toContain(
        value,
      );
    });

    it("works once only", async () => {
      await login("once@example.fr");
      const token = tokenFromMail();

      expect((await verify(token)).statusCode).toBe(200);
      const second = await verify(token);

      expect(second.statusCode).toBe(400);
      expect(second.cookies.find((c) => c.name === "session")).toBeUndefined();
    });

    it("refuses an unknown token", async () => {
      expect((await verify("x".repeat(43))).statusCode).toBe(400);
    });

    it("refuses an expired token", async () => {
      await login("late@example.fr");
      const token = tokenFromMail();
      await h.db
        .update(loginTokens)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(loginTokens.tokenHash, hashToken(token)));

      expect((await verify(token)).statusCode).toBe(400);
    });

    it("gives the same user back on a second login", async () => {
      const first = await signIn(h, "again@example.fr");
      const second = await signIn(h, "again@example.fr");

      const a = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: first.headers,
      });
      const b = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: second.headers,
      });
      expect(a.json().user.id).toBe(b.json().user.id);
    });

    it("marks the cookie Secure when configured", async () => {
      const secure = await createHarness(adminUrl as string, {
        secureCookies: true,
      });
      try {
        await secure.app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: "s@example.fr" },
        });
        const token = /token=([A-Za-z0-9_-]+)/.exec(
          secure.mailer.sent[0]!.text,
        )![1]!;
        const response = await secure.app.inject({
          method: "POST",
          url: "/auth/verify",
          payload: { token },
        });
        expect(response.cookies.find((c) => c.name === "session")?.secure).toBe(
          true,
        );
      } finally {
        await secure.close();
      }
    });
  });

  describe("GET /me", () => {
    it("requires a session", async () => {
      const response = await h.app.inject({ method: "GET", url: "/me" });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: "unauthorized" });
    });

    it("returns the signed-in user", async () => {
      const { headers } = await signIn(h, "me@example.fr");

      const response = await h.app.inject({
        method: "GET",
        url: "/me",
        headers,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().user.email).toBe("me@example.fr");
    });

    it("refuses a made-up cookie", async () => {
      const response = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie: `session=${"a".repeat(43)}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it("refuses an expired session", async () => {
      const { headers, cookie } = await signIn(h, "expired@example.fr");
      await h.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(
          eq(sessions.tokenHash, hashToken(cookie.slice("session=".length))),
        );

      const response = await h.app.inject({
        method: "GET",
        url: "/me",
        headers,
      });

      expect(response.statusCode).toBe(401);
    });

    it("refuses a request whose Origin is not the app, even with a valid session", async () => {
      const { cookie } = await signIn(h, "csrf@example.fr");

      const evil = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie, origin: "https://evil.example" },
      });
      const site = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie, origin: "https://www.example.fr" },
      });
      const noOrigin = await h.app.inject({
        method: "GET",
        url: "/me",
        headers: { cookie },
      });

      expect(evil.statusCode).toBe(403);
      expect(site.statusCode).toBe(403);
      expect(noOrigin.statusCode).toBe(200);
    });
  });

  describe("POST /auth/logout", () => {
    it("ends the session server-side and clears the cookie", async () => {
      const { headers, cookie } = await signIn(h, "bye@example.fr");

      const response = await h.app.inject({
        method: "POST",
        url: "/auth/logout",
        headers,
      });

      expect(response.statusCode).toBe(204);
      expect(response.cookies.find((c) => c.name === "session")?.value).toBe(
        "",
      );
      const after = await h.app.inject({ method: "GET", url: "/me", headers });
      expect(after.statusCode).toBe(401);
      const rows = await h.db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, hashToken(cookie.slice("session=".length))),
          ),
        );
      expect(rows).toHaveLength(0);
    });

    it("requires a session", async () => {
      const response = await h.app.inject({
        method: "POST",
        url: "/auth/logout",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("rate limit", () => {
    it("limits login requests per IP", async () => {
      const limited = await createHarness(adminUrl as string, {
        loginRateLimit: { max: 2, windowSeconds: 3600 },
      });
      try {
        const post = () =>
          limited.app.inject({
            method: "POST",
            url: "/auth/login",
            payload: { email: "rl@example.fr" },
          });
        expect((await post()).statusCode).toBe(202);
        expect((await post()).statusCode).toBe(202);
        const third = await post();

        expect(third.statusCode).toBe(429);
        expect(third.json()).toMatchObject({ error: "rate_limited" });
      } finally {
        await limited.close();
      }
    });
  });
});
