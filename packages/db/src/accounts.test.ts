import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import {
  auditPages,
  audits,
  findings,
  loginTokens,
  memberships,
  organizations,
  pages,
  remediationTasks,
  sessions,
  sites,
  users,
} from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  pgErrorCode,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => undefined,
    (e: unknown) => e,
  );

describe.skipIf(adminUrl === undefined)("accounts and findings schema", () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  async function insertUser(email: string) {
    const [user] = await test.db.insert(users).values({ email }).returning();
    return user!;
  }
  async function insertOrg() {
    const [org] = await test.db
      .insert(organizations)
      .values({ name: "Acme" })
      .returning();
    return org!;
  }
  async function insertSiteWithAudit() {
    const org = await insertOrg();
    const [site] = await test.db
      .insert(sites)
      .values({
        orgId: org.id,
        baseUrl: "https://acme.example",
        verificationToken: "tok",
      })
      .returning();
    const [audit] = await test.db
      .insert(audits)
      .values({ siteId: site!.id, type: "manual" })
      .returning();
    const [page] = await test.db
      .insert(pages)
      .values({ siteId: site!.id, url: "https://acme.example/" })
      .returning();
    return { site: site!, audit: audit!, page: page! };
  }

  describe("users", () => {
    it("keeps one user per email", async () => {
      await insertUser("one@acme.fr");

      expect(pgErrorCode(await failure(insertUser("one@acme.fr")))).toBe(
        "23505",
      );
    });

    it("refuses an email that is not normalized (lowercase)", async () => {
      expect(pgErrorCode(await failure(insertUser("Mixed@Acme.fr")))).toBe(
        "23514",
      );
    });
  });

  describe("memberships", () => {
    it("links a user to an organization once, with a role", async () => {
      const user = await insertUser("member@acme.fr");
      const org = await insertOrg();
      await test.db
        .insert(memberships)
        .values({ userId: user.id, orgId: org.id, role: "owner" });

      const error = await failure(
        test.db
          .insert(memberships)
          .values({ userId: user.id, orgId: org.id, role: "member" }),
      );
      expect(pgErrorCode(error)).toBe("23505");
    });

    it("rejects an unknown role", async () => {
      const user = await insertUser("role@acme.fr");
      const org = await insertOrg();
      const error = await failure(
        test.db
          .insert(memberships)
          // @ts-expect-error deliberately outside the enum
          .values({ userId: user.id, orgId: org.id, role: "admin" }),
      );
      expect(pgErrorCode(error)).toBe("22P02");
    });

    it("disappears with the user or the organization", async () => {
      const user = await insertUser("cascade@acme.fr");
      const org = await insertOrg();
      await test.db
        .insert(memberships)
        .values({ userId: user.id, orgId: org.id, role: "owner" });

      await test.db.delete(organizations).where(eq(organizations.id, org.id));

      expect(
        await test.db
          .select()
          .from(memberships)
          .where(eq(memberships.userId, user.id)),
      ).toHaveLength(0);
    });
  });

  describe("login tokens and sessions", () => {
    it("stores a login token hash once and starts it unused", async () => {
      const values = {
        tokenHash: "h1",
        email: "t@acme.fr",
        expiresAt: new Date(Date.now() + 60_000),
      };
      const [token] = await test.db
        .insert(loginTokens)
        .values(values)
        .returning();
      expect(token?.usedAt).toBeNull();

      expect(
        pgErrorCode(await failure(test.db.insert(loginTokens).values(values))),
      ).toBe("23505");
    });

    it("stores a session hash once and drops sessions with their user", async () => {
      const user = await insertUser("session@acme.fr");
      const values = {
        tokenHash: "s1",
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      };
      await test.db.insert(sessions).values(values);
      expect(
        pgErrorCode(await failure(test.db.insert(sessions).values(values))),
      ).toBe("23505");

      await test.db.delete(users).where(eq(users.id, user.id));
      expect(
        await test.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, user.id)),
      ).toHaveLength(0);
    });
  });

  describe("sites and audit pages", () => {
    it("keeps the verification token and no verification by default", async () => {
      const { site } = await insertSiteWithAudit();

      expect(site.verificationToken).toBe("tok");
      expect(site.verifiedAt).toBeNull();
    });

    it("starts an audit page as pending", async () => {
      const { audit, page } = await insertSiteWithAudit();
      const [row] = await test.db
        .insert(auditPages)
        .values({ auditId: audit.id, pageId: page.id })
        .returning();

      expect(row?.status).toBe("pending");
    });

    it("rejects an unknown audit page status", async () => {
      const { audit, page } = await insertSiteWithAudit();
      const error = await failure(
        test.db
          .insert(auditPages)
          // @ts-expect-error deliberately outside the enum
          .values({ auditId: audit.id, pageId: page.id, status: "weird" }),
      );
      expect(pgErrorCode(error)).toBe("22P02");
    });
  });

  describe("active audits", () => {
    const insertAudit = (
      siteId: string,
      type: "free" | "manual" | "scheduled",
      status: "queued" | "running" | "completed" | "failed",
    ) => test.db.insert(audits).values({ siteId, type, status });

    it("allows a single queued or running multi-page audit per site", async () => {
      const { site } = await insertSiteWithAudit();
      await test.db
        .update(audits)
        .set({ status: "completed" })
        .where(eq(audits.siteId, site.id));
      await insertAudit(site.id, "manual", "running");

      expect(
        pgErrorCode(await failure(insertAudit(site.id, "manual", "queued"))),
      ).toBe("23505");
      expect(
        pgErrorCode(await failure(insertAudit(site.id, "scheduled", "queued"))),
      ).toBe("23505");
    });

    it("allows another one once the first is over", async () => {
      const { site } = await insertSiteWithAudit();
      await test.db
        .update(audits)
        .set({ status: "failed" })
        .where(eq(audits.siteId, site.id));

      await expect(
        insertAudit(site.id, "manual", "queued"),
      ).resolves.toBeDefined();
    });

    it("does not restrict free audits, which share anonymous sites", async () => {
      const [site] = await test.db
        .insert(sites)
        .values({ baseUrl: "https://free.example" })
        .returning();

      await insertAudit(site!.id, "free", "queued");
      await expect(
        insertAudit(site!.id, "free", "queued"),
      ).resolves.toBeDefined();
    });
  });

  describe("findings", () => {
    async function insertFinding(
      overrides: Partial<typeof findings.$inferInsert> = {},
    ) {
      const { site, audit, page } = await insertSiteWithAudit();
      const values = {
        siteId: site.id,
        pageId: page.id,
        ruleId: "image-alt",
        fingerprint: "fp",
        impact: "serious" as const,
        selector: "img.hero",
        htmlExcerpt: "<img>",
        message: "Images must have alternate text",
        firstSeenAuditId: audit.id,
        lastSeenAuditId: audit.id,
        priorityScore: 6,
        ...overrides,
      };
      const [finding] = await test.db
        .insert(findings)
        .values(values)
        .returning();
      return { finding: finding!, values, audit };
    }

    it("starts open, never regressed", async () => {
      const { finding } = await insertFinding();

      expect(finding.status).toBe("open");
      expect(finding.regressedAuditId).toBeNull();
    });

    it("is unique per site, page and fingerprint", async () => {
      const { values } = await insertFinding();

      expect(
        pgErrorCode(await failure(test.db.insert(findings).values(values))),
      ).toBe("23505");
    });

    it("allows the same fingerprint on another page of the site", async () => {
      const { values } = await insertFinding();
      const [other] = await test.db
        .insert(pages)
        .values({ siteId: values.siteId, url: "https://acme.example/b" })
        .returning();

      await expect(
        test.db.insert(findings).values({ ...values, pageId: other!.id }),
      ).resolves.toBeDefined();
    });

    it("rejects an unknown status and a rule missing from the reference", async () => {
      const { values } = await insertFinding();
      const [other] = await test.db
        .insert(pages)
        .values({ siteId: values.siteId, url: "https://acme.example/c" })
        .returning();

      const badStatus = await failure(
        test.db
          .insert(findings)
          // @ts-expect-error deliberately outside the enum
          .values({ ...values, pageId: other!.id, status: "gone" }),
      );
      expect(pgErrorCode(badStatus)).toBe("22P02");

      const badRule = await failure(
        test.db
          .insert(findings)
          .values({ ...values, pageId: other!.id, ruleId: "no-such-rule" }),
      );
      expect(pgErrorCode(badRule)).toBe("23503");
    });

    it("survives the purge of the audit that first saw it", async () => {
      const { finding, audit } = await insertFinding();

      await test.db.delete(audits).where(eq(audits.id, audit.id));

      const [after] = await test.db
        .select()
        .from(findings)
        .where(eq(findings.id, finding.id));
      expect(after?.firstSeenAuditId).toBeNull();
      expect(after?.lastSeenAuditId).toBeNull();
    });

    it("goes away with its site", async () => {
      const { finding, values } = await insertFinding();

      await test.db.delete(sites).where(eq(sites.id, values.siteId));

      expect(
        await test.db
          .select()
          .from(findings)
          .where(eq(findings.id, finding.id)),
      ).toHaveLength(0);
    });
  });

  describe("remediation tasks", () => {
    async function insertTask(
      overrides: Partial<typeof remediationTasks.$inferInsert> = {},
    ) {
      const { site } = await insertSiteWithAudit();
      const values = {
        siteId: site.id,
        ruleId: "image-alt",
        priorityScore: 12,
        ...overrides,
      };
      const [task] = await test.db
        .insert(remediationTasks)
        .values(values)
        .returning();
      return { task: task!, values };
    }

    it("starts to do, unassigned", async () => {
      const { task } = await insertTask();

      expect(task.status).toBe("todo");
      expect(task.assigneeUserId).toBeNull();
    });

    it("is unique per site and rule", async () => {
      const { values } = await insertTask();

      expect(
        pgErrorCode(
          await failure(test.db.insert(remediationTasks).values(values)),
        ),
      ).toBe("23505");
    });

    it("allows the same rule on another site", async () => {
      const { values } = await insertTask();
      const { site } = await insertSiteWithAudit();

      await expect(
        test.db.insert(remediationTasks).values({ ...values, siteId: site.id }),
      ).resolves.toBeDefined();
    });

    it("rejects an unknown status and a rule missing from the reference", async () => {
      const { site } = await insertSiteWithAudit();

      const badStatus = await failure(
        test.db
          .insert(remediationTasks)
          // @ts-expect-error deliberately outside the enum
          .values({
            siteId: site.id,
            ruleId: "image-alt",
            priorityScore: 1,
            status: "stuck",
          }),
      );
      expect(pgErrorCode(badStatus)).toBe("22P02");
      const badRule = await failure(
        test.db.insert(remediationTasks).values({
          siteId: site.id,
          ruleId: "no-such-rule",
          priorityScore: 1,
        }),
      );
      expect(pgErrorCode(badRule)).toBe("23503");
    });

    it("keeps the task when its assignee is deleted, and drops it with its site", async () => {
      const user = await insertUser("assignee@acme.fr");
      const { task, values } = await insertTask({ assigneeUserId: user.id });

      await test.db.delete(users).where(eq(users.id, user.id));
      const [kept] = await test.db
        .select()
        .from(remediationTasks)
        .where(eq(remediationTasks.id, task.id));
      expect(kept?.assigneeUserId).toBeNull();

      await test.db.delete(sites).where(eq(sites.id, values.siteId));
      expect(
        await test.db
          .select()
          .from(remediationTasks)
          .where(eq(remediationTasks.id, task.id)),
      ).toHaveLength(0);
    });
  });
});
