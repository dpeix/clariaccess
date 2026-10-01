import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations, seedRules } from "./migrate.js";
import {
  audits,
  issues,
  leads,
  organizations,
  pages,
  sites,
} from "./schema.js";
import {
  adminDatabaseUrl,
  createTestDatabase,
  pgErrorCode,
  type TestDatabase,
} from "./test-helpers.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("schema", () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  async function insertAudit() {
    const [org] = await test.db
      .insert(organizations)
      .values({ name: "Acme" })
      .returning();
    const [site] = await test.db
      .insert(sites)
      .values({ orgId: org!.id, baseUrl: "https://acme.example" })
      .returning();
    const [audit] = await test.db
      .insert(audits)
      .values({ siteId: site!.id, type: "free" })
      .returning();
    const [page] = await test.db
      .insert(pages)
      .values({ siteId: site!.id, url: "https://acme.example/" })
      .returning();
    return { org: org!, site: site!, audit: audit!, page: page! };
  }

  it("round-trips an audit with defaults and a JSONB issue payload", async () => {
    const { audit, page } = await insertAudit();
    expect(audit.status).toBe("queued");
    expect(audit.pagesScanned).toBe(0);
    expect(audit.score).toBeNull();

    const raw = { nodes: [{ target: ["img.hero"] }], tags: ["wcag111"] };
    await test.db.insert(issues).values({
      auditId: audit.id,
      pageId: page.id,
      ruleId: "image-alt",
      impact: "critical",
      selector: "img.hero",
      htmlExcerpt: '<img src="a.png">',
      message: "Images must have alternate text",
      fingerprint: "image-alt|img.hero|home",
      raw,
    });

    const [row] = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, audit.id));
    expect(row?.raw).toEqual(raw);
    expect(row?.impact).toBe("critical");
  });

  it("allows an anonymous site for free audits (no organization)", async () => {
    const [site] = await test.db
      .insert(sites)
      .values({ baseUrl: "https://anonymous.example" })
      .returning();
    expect(site?.orgId).toBeNull();
  });

  it("rejects an issue pointing to a missing audit (foreign key)", async () => {
    const { page } = await insertAudit();
    const error = await test.db
      .insert(issues)
      .values({
        auditId: "00000000-0000-4000-8000-000000000000",
        pageId: page.id,
        ruleId: "image-alt",
        impact: "minor",
        selector: "a",
        htmlExcerpt: "",
        message: "",
        fingerprint: "f",
        raw: {},
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects an issue for a rule that is not in the rules table", async () => {
    const { audit, page } = await insertAudit();
    const error = await test.db
      .insert(issues)
      .values({
        auditId: audit.id,
        pageId: page.id,
        ruleId: "rule-added-by-a-future-axe",
        impact: "minor",
        selector: "a",
        htmlExcerpt: "",
        message: "",
        fingerprint: "f",
        raw: {},
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects a score above 100 (check constraint)", async () => {
    const { site } = await insertAudit();
    const error = await test.db
      .insert(audits)
      .values({ siteId: site.id, type: "free", score: 101 })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("rejects an invalid enum value at the database level", async () => {
    const { site } = await insertAudit();
    const error = await test.db
      .insert(audits)
      // @ts-expect-error deliberately outside the enum
      .values({ siteId: site.id, type: "paid" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("22P02");
  });

  it("requires consent and its timestamp on a lead", async () => {
    const error = await test.db
      .insert(leads)
      // @ts-expect-error consent is required
      .values({ email: "a@b.fr" })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23502");

    const [lead] = await test.db
      .insert(leads)
      .values({ email: "a@b.fr", consent: true })
      .returning();
    expect(lead?.consentedAt).toBeInstanceOf(Date);
  });

  it("rejects a lead without consent", async () => {
    const error = await test.db
      .insert(leads)
      .values({ email: "no@consent.fr", consent: false })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("stores a single lead per email and audit", async () => {
    const { audit } = await insertAudit();
    const values = { email: "dup@b.fr", consent: true, auditId: audit.id };
    await test.db.insert(leads).values(values);
    const error = await test.db
      .insert(leads)
      .values(values)
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("starts a lead with no report sent and an audit with no failure reason", async () => {
    const { audit } = await insertAudit();
    const [lead] = await test.db
      .insert(leads)
      .values({ email: "new@b.fr", consent: true, auditId: audit.id })
      .returning();
    expect(lead?.reportSentAt).toBeNull();
    expect(audit.failureReason).toBeNull();
  });

  it("only accepts known audit failure reasons", async () => {
    const { site } = await insertAudit();
    const error = await test.db
      .insert(audits)
      .values({
        siteId: site.id,
        type: "free",
        status: "failed",
        // Cast: the type already forbids it, the database must too.
        failureReason: "because" as "scan_failed",
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(pgErrorCode(error)).toBe("22P02");
  });

  it("keeps a lead when its audit is deleted", async () => {
    const { audit } = await insertAudit();
    const [lead] = await test.db
      .insert(leads)
      .values({ email: "c@d.fr", consent: true, auditId: audit.id })
      .returning();

    await test.db.delete(audits).where(eq(audits.id, audit.id));

    const [after] = await test.db
      .select()
      .from(leads)
      .where(eq(leads.id, lead!.id));
    expect(after?.auditId).toBeNull();
  });

  it("deletes audits, pages and issues with their site", async () => {
    const { site, audit, page } = await insertAudit();
    await test.db.insert(issues).values({
      auditId: audit.id,
      pageId: page.id,
      ruleId: "image-alt",
      impact: "minor",
      selector: "a",
      htmlExcerpt: "",
      message: "",
      fingerprint: "f",
      raw: {},
    });

    await test.db.delete(sites).where(eq(sites.id, site.id));

    expect(
      await test.db.select().from(audits).where(eq(audits.siteId, site.id)),
    ).toHaveLength(0);
    expect(
      await test.db.select().from(issues).where(eq(issues.auditId, audit.id)),
    ).toHaveLength(0);
  });
});
